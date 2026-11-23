//! The few JavaScript behaviours the Preferences contract depends on: how numbers round, how
//! strings are measured and trimmed, and which values count as true. CamFrame 0.9.0 wrote its
//! rules in JavaScript, so the Rust rules must give the same answers.

use serde::Serializer;
use serde_json::Value;

/// `Math.round`: halves round up (towards positive infinity).
pub fn round(value: f64) -> f64 {
    let floor = value.floor();
    if value - floor >= 0.5 { floor + 1.0 } else { floor }
}

pub fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

/// `Number.isFinite(value)`: a JSON number (serde_json never holds NaN or infinity).
pub fn finite(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64)
}

/// `Number.isInteger(value)`: a JSON number with no fraction (3.0 counts).
pub fn integer(value: Option<&Value>) -> Option<i64> {
    let number = finite(value)?;
    (number.fract() == 0.0).then_some(number as i64)
}

/// JavaScript truthiness of a JSON value.
pub fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|n| n != 0.0),
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

/// `text.slice(0, units)`: the first `units` UTF-16 code units. A surrogate pair cut in half by the
/// limit is left out whole (JavaScript would keep half a pair, which a Rust string cannot hold).
pub fn slice_utf16(text: &str, units: usize) -> String {
    let mut used = 0;
    let mut end = 0;
    for (index, character) in text.char_indices() {
        used += character.len_utf16();
        if used > units {
            break;
        }
        end = index + character.len_utf8();
    }
    text[..end].to_string()
}

pub fn len_utf16(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// What `String.prototype.trim` removes: Unicode white space and line ends, plus the byte order
/// mark, but not U+0085.
fn is_js_space(character: char) -> bool {
    (character.is_whitespace() && character != '\u{85}') || character == '\u{feff}'
}

/// `text.trim()`.
pub fn trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

/// The number value `a < b` compares for `(value ?? 0)`: null or missing is 0, a boolean is 0 or 1, a
/// string is its number (NaN when it is not one), anything else is NaN.
pub fn number_or_zero(value: Option<&Value>) -> f64 {
    match value {
        None | Some(Value::Null) => 0.0,
        Some(Value::Bool(flag)) => f64::from(u8::from(*flag)),
        Some(Value::Number(number)) => number.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(text)) => {
            let text = trim(text);
            if text.is_empty() { 0.0 } else { text.parse().unwrap_or(f64::NAN) }
        }
        Some(_) => f64::NAN,
    }
}

/// Writes a number the way `JSON.stringify` does: whole numbers without a fraction.
pub fn serialize_number<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    if value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        serializer.serialize_i64(*value as i64)
    } else {
        serializer.serialize_f64(*value)
    }
}

pub fn serialize_optional_number<S: Serializer>(value: &Option<f64>, serializer: S) -> Result<S::Ok, S::Error> {
    match value {
        Some(number) => serialize_number(number, serializer),
        None => serializer.serialize_none(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_matches_math_round() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(0.49999999999999994), 0.0);
        assert_eq!(round(1383.9999), 1384.0);
    }

    #[test]
    fn slice_counts_utf16_units() {
        assert_eq!(slice_utf16("abc", 2), "ab");
        assert_eq!(slice_utf16("a😀b", 3), "a😀");
        assert_eq!(slice_utf16("a😀b", 2), "a");
        assert_eq!(len_utf16("a😀"), 3);
    }

    #[test]
    fn trim_matches_javascript() {
        assert_eq!(trim("\u{feff} Desk \u{2028}"), "Desk");
        assert_eq!(trim("\u{85}Desk"), "\u{85}Desk");
    }

    #[test]
    fn schema_comparison_coerces_like_javascript() {
        assert_eq!(number_or_zero(None), 0.0);
        assert_eq!(number_or_zero(Some(&Value::String(" 14 ".into()))), 14.0);
        assert!(number_or_zero(Some(&Value::String("x".into()))).is_nan());
    }
}
