//! The MPQ reader's byte source over the page: a JS callback that returns a range of one archive.

use std::io;
use std::sync::Mutex;

use benilla_mpq::Source;
use wasm_bindgen::JsValue;

/// How much a miss fetches ahead. The reader walks hash and block tables in 4 KiB sector-sized
/// pieces and then a file sector by sector, so one request per 512 KiB keeps the round trips down
/// while staying well inside a worker's memory.
const READAHEAD: usize = 512 * 1024;

/// One archive's bytes, read through `read(id, offset, length) -> Uint8Array`.
pub struct JsSource {
    /// The archive's slot in the page's archive list; the callback routes on it.
    id: u32,
    len: u64,
    label: String,
    read: js_sys::Function,
    /// The last window fetched, so the table walk and sequential sector reads reuse one request.
    window: Mutex<Option<Window>>,
}

struct Window {
    start: u64,
    bytes: Vec<u8>,
}

// wasm32 is single-threaded and the callback is only ever called from this instance's thread. The
// bound is `benilla_mpq::Source`'s, which exists for the native reader that shares handles across
// threads.
unsafe impl Send for JsSource {}
unsafe impl Sync for JsSource {}

impl JsSource {
    pub fn new(id: u32, len: u64, label: String, read: js_sys::Function) -> Self {
        Self {
            id,
            len,
            label,
            read,
            window: Mutex::new(None),
        }
    }

    /// `len` bytes at `offset`, from the cached window when it covers them, else one fetch.
    fn fetch(&self, offset: u64, len: usize) -> io::Result<Vec<u8>> {
        if len == 0 {
            return Ok(Vec::new());
        }
        let end = offset
            .checked_add(len as u64)
            .filter(|&end| end <= self.len)
            .ok_or_else(|| {
                io::Error::other(format!(
                    "{}: read of {len} bytes at {offset} runs past the archive's {} bytes",
                    self.label, self.len
                ))
            })?;
        let mut guard = self
            .window
            .lock()
            .map_err(|_| io::Error::other("archive window lock poisoned"))?;
        if let Some(w) = guard.as_ref() {
            if offset >= w.start && end <= w.start + w.bytes.len() as u64 {
                let from = (offset - w.start) as usize;
                return Ok(w.bytes[from..from + len].to_vec());
            }
        }

        // A miss: fetch the request, or `READAHEAD` bytes from it when the archive has them.
        let want = len.max(READAHEAD).min((self.len - offset) as usize);
        let bytes = self.call(offset, want)?;
        if bytes.len() != want {
            return Err(io::Error::other(format!(
                "{}: read of {want} bytes at {offset} returned {}",
                self.label,
                bytes.len()
            )));
        }
        *guard = Some(Window {
            start: offset,
            bytes,
        });
        Ok(guard
            .as_ref()
            .map(|w| w.bytes[..len].to_vec())
            .unwrap_or_default())
    }

    /// One call into the page's read callback.
    fn call(&self, offset: u64, len: usize) -> io::Result<Vec<u8>> {
        let args = [
            JsValue::from_f64(f64::from(self.id)),
            JsValue::from_f64(offset as f64),
            JsValue::from_f64(len as f64),
        ];
        let out = self
            .read
            .call3(&JsValue::UNDEFINED, &args[0], &args[1], &args[2])
            .map_err(|e| {
                io::Error::other(format!(
                    "{}: range read at {offset} failed: {e:?}",
                    self.label
                ))
            })?;
        let arr = js_sys::Uint8Array::new(&out);
        let mut bytes = vec![0u8; arr.length() as usize];
        arr.copy_to(&mut bytes);
        Ok(bytes)
    }
}

impl Source for JsSource {
    fn len(&self) -> u64 {
        self.len
    }

    fn read_at(&self, offset: u64, len: usize) -> io::Result<Vec<u8>> {
        self.fetch(offset, len)
    }

    fn label(&self) -> String {
        self.label.clone()
    }
}
