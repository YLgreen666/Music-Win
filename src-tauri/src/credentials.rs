use std::{fs, ptr};
use tauri::Manager;
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    },
};

fn protect(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    // DPAPI binds encryption to the current Windows user. No secrets in logs.
    let ok = unsafe {
        if decrypt {
            CryptUnprotectData(
                &input,
                ptr::null_mut(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptProtectData(
                &input,
                ptr::null(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err("Windows 登录凭据加密/解密失败，请重新扫码".into());
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(result)
}
#[tauri::command]
pub fn load_login(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("login.dpapi");
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|_| "无法读取登录凭据")?;
    String::from_utf8(protect(&bytes, true)?)
        .map(Some)
        .map_err(|_| "登录凭据失效，请重新扫码".into())
}
#[tauri::command]
pub fn save_login(app: tauri::AppHandle, value: Option<String>) -> Result<(), String> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join("login.dpapi");
    if let Some(value) = value {
        if value.len() > 128 * 1024 {
            return Err("登录凭据格式无效".into());
        }
        fs::write(path, protect(value.as_bytes(), false)?).map_err(|_| "登录凭据保存失败".into())
    } else {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("登录凭据清除失败".into()),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dpapi_roundtrip() {
        let secret = b"test only";
        let encrypted = protect(secret, false).unwrap();
        assert_ne!(encrypted, secret);
        assert_eq!(protect(&encrypted, true).unwrap(), secret);
    }
}
