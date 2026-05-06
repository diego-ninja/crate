use std::fs::File;
use std::io::{self, Read, Seek, Write};
use std::path::Path;

use crc32fast::Hasher;

const ZIP_STORED: u16 = 0;
const ZIP_USE_DATA_DESCRIPTOR: u16 = 0x08;
const ZIP_VERSION_NEEDED: u16 = 20;
const ZIP64_VERSION_NEEDED: u16 = 45;
const ZIP64_EXTRA_ID: u16 = 0x0001;

pub struct StoredZipWriter<W: Write + Seek> {
    writer: W,
    entries: Vec<CentralDirectoryEntry>,
}

struct CentralDirectoryEntry {
    name: String,
    crc32: u32,
    compressed_size: u64,
    uncompressed_size: u64,
    local_header_offset: u64,
}

impl<W: Write + Seek> StoredZipWriter<W> {
    pub fn new(writer: W) -> Self {
        Self {
            writer,
            entries: Vec::new(),
        }
    }

    pub fn add_file(&mut self, name: &str, path: &Path) -> io::Result<u64> {
        self.add_file_checked(name, path, None)
    }

    pub fn add_file_checked(
        &mut self,
        name: &str,
        path: &Path,
        cancel_check: Option<&dyn Fn() -> bool>,
    ) -> io::Result<u64> {
        let file = File::open(path)?;
        let size = file.metadata()?.len();
        self.add_sized_reader(name, file, Some(size), cancel_check)
    }

    pub fn add_bytes(&mut self, name: &str, bytes: &[u8]) -> io::Result<u64> {
        self.add_sized_reader(name, bytes, Some(bytes.len() as u64), None)
    }

    pub fn add_reader<R: Read>(&mut self, name: &str, mut reader: R) -> io::Result<u64> {
        self.add_sized_reader(name, &mut reader, None, None)
    }

    fn add_sized_reader<R: Read>(
        &mut self,
        name: &str,
        mut reader: R,
        known_size: Option<u64>,
        cancel_check: Option<&dyn Fn() -> bool>,
    ) -> io::Result<u64> {
        validate_name(name)?;
        let local_header_offset = self.writer.stream_position()?;
        let name_bytes = name.as_bytes();
        let local_zip64 = known_size
            .map(|size| size > u32::MAX as u64)
            .unwrap_or(true);
        let version_needed = if local_zip64 {
            ZIP64_VERSION_NEEDED
        } else {
            ZIP_VERSION_NEEDED
        };
        let local_extra = if local_zip64 {
            zip64_local_extra(known_size.unwrap_or(0), known_size.unwrap_or(0))
        } else {
            Vec::new()
        };

        write_u32(&mut self.writer, 0x0403_4b50)?;
        write_u16(&mut self.writer, version_needed)?;
        write_u16(&mut self.writer, ZIP_USE_DATA_DESCRIPTOR)?;
        write_u16(&mut self.writer, ZIP_STORED)?;
        write_u16(&mut self.writer, 0)?;
        write_u16(&mut self.writer, 0)?;
        write_u32(&mut self.writer, 0)?;
        write_u32(&mut self.writer, if local_zip64 { u32::MAX } else { 0 })?;
        write_u32(&mut self.writer, if local_zip64 { u32::MAX } else { 0 })?;
        write_u16(
            &mut self.writer,
            checked_u16(name_bytes.len(), "zip name length")?,
        )?;
        write_u16(
            &mut self.writer,
            checked_u16(local_extra.len(), "zip extra length")?,
        )?;
        self.writer.write_all(name_bytes)?;
        self.writer.write_all(&local_extra)?;

        let mut hasher = Hasher::new();
        let mut buffer = [0_u8; 1024 * 1024];
        let mut size = 0_u64;
        loop {
            check_cancelled(cancel_check)?;
            let read = reader.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            size += read as u64;
            if !local_zip64 && size > u32::MAX as u64 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "zip entry exceeded expected non-ZIP64 size",
                ));
            }
            hasher.update(&buffer[..read]);
            self.writer.write_all(&buffer[..read])?;
        }

        let crc32 = hasher.finalize();
        write_u32(&mut self.writer, 0x0807_4b50)?;
        write_u32(&mut self.writer, crc32)?;
        if local_zip64 {
            write_u64(&mut self.writer, size)?;
            write_u64(&mut self.writer, size)?;
        } else {
            let size32 = checked_u32(size, "zip entry size")?;
            write_u32(&mut self.writer, size32)?;
            write_u32(&mut self.writer, size32)?;
        }

        self.entries.push(CentralDirectoryEntry {
            name: name.to_string(),
            crc32,
            compressed_size: size,
            uncompressed_size: size,
            local_header_offset,
        });

        Ok(size)
    }

    pub fn finish(mut self) -> io::Result<()> {
        let central_start = self.writer.stream_position()?;

        for entry in &self.entries {
            let name_bytes = entry.name.as_bytes();
            let central_zip64 = needs_zip64_central(entry);
            let central_extra = if central_zip64 {
                zip64_central_extra(entry)
            } else {
                Vec::new()
            };
            let version_needed = if central_zip64 {
                ZIP64_VERSION_NEEDED
            } else {
                ZIP_VERSION_NEEDED
            };
            write_u32(&mut self.writer, 0x0201_4b50)?;
            write_u16(&mut self.writer, version_needed)?;
            write_u16(&mut self.writer, version_needed)?;
            write_u16(&mut self.writer, ZIP_USE_DATA_DESCRIPTOR)?;
            write_u16(&mut self.writer, ZIP_STORED)?;
            write_u16(&mut self.writer, 0)?;
            write_u16(&mut self.writer, 0)?;
            write_u32(&mut self.writer, entry.crc32)?;
            write_u32(
                &mut self.writer,
                if central_zip64 {
                    u32::MAX
                } else {
                    checked_u32(entry.compressed_size, "zip compressed size")?
                },
            )?;
            write_u32(
                &mut self.writer,
                if central_zip64 {
                    u32::MAX
                } else {
                    checked_u32(entry.uncompressed_size, "zip uncompressed size")?
                },
            )?;
            write_u16(
                &mut self.writer,
                checked_u16(name_bytes.len(), "zip name length")?,
            )?;
            write_u16(
                &mut self.writer,
                checked_u16(central_extra.len(), "zip extra length")?,
            )?;
            write_u16(&mut self.writer, 0)?;
            write_u16(&mut self.writer, 0)?;
            write_u16(&mut self.writer, 0)?;
            write_u32(&mut self.writer, 0)?;
            write_u32(
                &mut self.writer,
                if central_zip64 {
                    u32::MAX
                } else {
                    checked_u32(entry.local_header_offset, "zip local header offset")?
                },
            )?;
            self.writer.write_all(name_bytes)?;
            self.writer.write_all(&central_extra)?;
        }

        let central_end = self.writer.stream_position()?;
        let central_size = central_end.checked_sub(central_start).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "invalid central directory")
        })?;
        let zip64_needed = self.entries.len() > u16::MAX as usize
            || central_start > u32::MAX as u64
            || central_size > u32::MAX as u64
            || self.entries.iter().any(needs_zip64_central);

        if zip64_needed {
            let zip64_eocd_offset = self.writer.stream_position()?;
            write_u32(&mut self.writer, 0x0606_4b50)?;
            write_u64(&mut self.writer, 44)?;
            write_u16(&mut self.writer, ZIP64_VERSION_NEEDED)?;
            write_u16(&mut self.writer, ZIP64_VERSION_NEEDED)?;
            write_u32(&mut self.writer, 0)?;
            write_u32(&mut self.writer, 0)?;
            write_u64(&mut self.writer, self.entries.len() as u64)?;
            write_u64(&mut self.writer, self.entries.len() as u64)?;
            write_u64(&mut self.writer, central_size)?;
            write_u64(&mut self.writer, central_start)?;

            write_u32(&mut self.writer, 0x0706_4b50)?;
            write_u32(&mut self.writer, 0)?;
            write_u64(&mut self.writer, zip64_eocd_offset)?;
            write_u32(&mut self.writer, 1)?;
        }

        let entries = if zip64_needed {
            u16::MAX
        } else {
            checked_u16(self.entries.len(), "zip entry count")?
        };
        let central_size32 = if zip64_needed {
            u32::MAX
        } else {
            checked_u32(central_size, "central directory size")?
        };
        let central_start32 = if zip64_needed {
            u32::MAX
        } else {
            checked_u32(central_start, "central directory offset")?
        };

        write_u32(&mut self.writer, 0x0605_4b50)?;
        write_u16(&mut self.writer, 0)?;
        write_u16(&mut self.writer, 0)?;
        write_u16(&mut self.writer, entries)?;
        write_u16(&mut self.writer, entries)?;
        write_u32(&mut self.writer, central_size32)?;
        write_u32(&mut self.writer, central_start32)?;
        write_u16(&mut self.writer, 0)?;
        self.writer.flush()
    }
}

fn check_cancelled(cancel_check: Option<&dyn Fn() -> bool>) -> io::Result<()> {
    if cancel_check.map(|check| check()).unwrap_or(false) {
        return Err(io::Error::new(io::ErrorKind::Interrupted, "job cancelled"));
    }
    Ok(())
}

fn validate_name(name: &str) -> io::Result<()> {
    if name.is_empty() || name.as_bytes().len() > u16::MAX as usize {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid zip entry name",
        ));
    }
    Ok(())
}

fn checked_u16(value: usize, label: &str) -> io::Result<u16> {
    u16::try_from(value)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, format!("{label} exceeds u16")))
}

fn checked_u32(value: u64, label: &str) -> io::Result<u32> {
    u32::try_from(value)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, format!("{label} exceeds u32")))
}

fn needs_zip64_central(entry: &CentralDirectoryEntry) -> bool {
    entry.compressed_size > u32::MAX as u64
        || entry.uncompressed_size > u32::MAX as u64
        || entry.local_header_offset > u32::MAX as u64
}

fn zip64_local_extra(uncompressed_size: u64, compressed_size: u64) -> Vec<u8> {
    let mut extra = Vec::with_capacity(20);
    push_u16(&mut extra, ZIP64_EXTRA_ID);
    push_u16(&mut extra, 16);
    push_u64(&mut extra, uncompressed_size);
    push_u64(&mut extra, compressed_size);
    extra
}

fn zip64_central_extra(entry: &CentralDirectoryEntry) -> Vec<u8> {
    let mut extra = Vec::with_capacity(28);
    push_u16(&mut extra, ZIP64_EXTRA_ID);
    push_u16(&mut extra, 24);
    push_u64(&mut extra, entry.uncompressed_size);
    push_u64(&mut extra, entry.compressed_size);
    push_u64(&mut extra, entry.local_header_offset);
    extra
}

fn write_u16<W: Write>(writer: &mut W, value: u16) -> io::Result<()> {
    writer.write_all(&value.to_le_bytes())
}

fn write_u32<W: Write>(writer: &mut W, value: u32) -> io::Result<()> {
    writer.write_all(&value.to_le_bytes())
}

fn write_u64<W: Write>(writer: &mut W, value: u64) -> io::Result<()> {
    writer.write_all(&value.to_le_bytes())
}

fn push_u16(buffer: &mut Vec<u8>, value: u16) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn push_u64(buffer: &mut Vec<u8>, value: u64) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::{
        needs_zip64_central, zip64_central_extra, zip64_local_extra, CentralDirectoryEntry,
    };

    #[test]
    fn zip64_extra_fields_encode_large_sizes_and_offsets() {
        let entry = CentralDirectoryEntry {
            name: "large.flac".to_string(),
            crc32: 0,
            compressed_size: u32::MAX as u64 + 10,
            uncompressed_size: u32::MAX as u64 + 10,
            local_header_offset: u32::MAX as u64 + 20,
        };

        assert!(needs_zip64_central(&entry));
        let central_extra = zip64_central_extra(&entry);
        assert_eq!(&central_extra[0..2], &0x0001_u16.to_le_bytes());
        assert_eq!(&central_extra[2..4], &24_u16.to_le_bytes());
        assert_eq!(central_extra.len(), 28);

        let local_extra = zip64_local_extra(entry.uncompressed_size, entry.compressed_size);
        assert_eq!(&local_extra[0..2], &0x0001_u16.to_le_bytes());
        assert_eq!(&local_extra[2..4], &16_u16.to_le_bytes());
        assert_eq!(local_extra.len(), 20);
    }
}
