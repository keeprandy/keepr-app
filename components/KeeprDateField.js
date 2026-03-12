import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import {
  formatDateForInput,
  parseFlexibleDateInput,
  isoToParts,
  partsToISO,
} from "../lib/dateFormat";

export default function KeeprDateField({
  value,          // ISO: YYYY-MM-DD
  onChange,       // returns ISO
  placeholder = "MM/DD/YYYY",
  style,
  inputStyle,
}) {
  const [showNativePicker, setShowNativePicker] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const webDateInputRef = useRef(null);

  useEffect(() => {
    setInputValue(formatDateForInput(value));
  }, [value]);

  const pickerDate = useMemo(() => {
    const parts = isoToParts(value);
    if (!parts) return new Date();
    return new Date(parts.year, parts.month - 1, parts.day);
  }, [value]);

  const commitISO = (iso) => {
    if (!iso) return;
    onChange?.(iso);
    setInputValue(formatDateForInput(iso));
  };

  const handleBlur = () => {
    const raw = String(inputValue || "").trim();

    if (!raw) {
      onChange?.(null);
      setInputValue("");
      return;
    }

    const iso = parseFlexibleDateInput(raw);
    if (!iso) {
      setInputValue(formatDateForInput(value));
      return;
    }

    commitISO(iso);
  };

  const handleNativePickerChange = (_event, selectedDate) => {
    if (Platform.OS !== "ios") {
      setShowNativePicker(false);
    }

    if (!selectedDate) return;

    const iso = partsToISO({
      year: selectedDate.getFullYear(),
      month: selectedDate.getMonth() + 1,
      day: selectedDate.getDate(),
    });

    commitISO(iso);
  };

  const handleWebDateChange = (e) => {
    const iso = e?.target?.value;
    if (!iso) return;
    commitISO(iso);
  };

  const openPicker = () => {
    if (Platform.OS === "web") {
      const el = webDateInputRef.current;
      if (!el) return;

      if (typeof el.showPicker === "function") {
        el.showPicker();
      } else {
        el.focus();
        el.click();
      }
      return;
    }

    setShowNativePicker(true);
  };

  return (
    <View style={style}>
      <View style={styles.field}>
        <TextInput
          style={[styles.input, inputStyle]}
          value={inputValue}
          onChangeText={setInputValue}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Pressable style={styles.iconBtn} onPress={openPicker}>
          <Ionicons name="calendar-outline" size={18} color="#6B7280" />
        </Pressable>
      </View>

      {Platform.OS === "web" ? (
        <input
          ref={webDateInputRef}
          type="date"
          value={value || ""}
          onChange={handleWebDateChange}
          tabIndex={-1}
          aria-hidden="true"
          style={{
            position: "absolute",
            opacity: 0,
            pointerEvents: "none",
            width: 1,
            height: 1,
          }}
        />
      ) : null}

      {showNativePicker && Platform.OS !== "web" ? (
        <DateTimePicker
          value={pickerDate}
          mode="date"
          display="default"
          onChange={handleNativePickerChange}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#F8FAFC",
    paddingLeft: 12,
    paddingRight: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  input: {
    flex: 1,
    fontSize: 13,
    color: "#111827",
    fontWeight: "600",
    paddingVertical: 10,
  },
  iconBtn: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
});