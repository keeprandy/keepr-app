import React, { useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Adjust these names if your /lib/dateFormat.js exports differ.
import {
  formatDateForInput,
  parseFlexibleDateInput,
} from "../lib/dateFormat";

/**
 * Keepr DateField
 *
 * Contract:
 * - `value` is ISO date string: YYYY-MM-DD or null
 * - `onChange` receives ISO date string or null
 * - user types US-friendly values: 3/12/26, 03/12/2026, today, yesterday
 *
 * Usage:
 *   const [serviceDate, setServiceDate] = useState(null);
 *
 *   <DateField
 *     label="Service Date"
 *     value={serviceDate}
 *     onChange={setServiceDate}
 *   />
 */
export default function DateField({
  label = "Date",
  value,
  onChange,
  placeholder = "MM/DD/YYYY",
  helperText = "You can type 3/12/2026, today, or yesterday",
  errorText,
  required = false,
  disabled = false,
  style,
  inputStyle,
}) {
  const [inputValue, setInputValue] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setInputValue(formatDateForInput(value));
  }, [value]);

  const activeError = errorText || localError || "";

  const handleBlur = () => {
    const raw = (inputValue || "").trim();

    if (!raw) {
      setLocalError("");
      onChange?.(null);
      return;
    }

    const parsed = parseFlexibleDateInput(raw);

    if (!parsed) {
      setLocalError("Enter a valid date");
      return;
    }

    setLocalError("");
    onChange?.(parsed);
    setInputValue(formatDateForInput(parsed));
  };

  const rightIconColor = useMemo(() => {
    if (disabled) return "#CBD5E1";
    if (activeError) return "#DC2626";
    return "#94A3B8";
  }, [disabled, activeError]);

  return (
    <View style={style}>
      {!!label && (
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
      )}

      <View
        style={[
          styles.fieldWrap,
          disabled && styles.fieldWrapDisabled,
          activeError && styles.fieldWrapError,
        ]}
      >
        <TextInput
          value={inputValue}
            onChangeText={(text) => {
            setInputValue(text);

            // try to parse live
            const iso = parseFlexibleDateInput(text);

            if (iso) {
                onChange?.(iso);
            }

            if (localError) setLocalError("");
            }}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor="#94A3B8"
          editable={!disabled}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
          style={[styles.input, inputStyle]}
        />

        <Pressable
          disabled
          style={styles.iconWrap}
          accessibilityRole="image"
          accessibilityLabel="Date field"
        >
          <Ionicons name="calendar-outline" size={18} color={rightIconColor} />
        </Pressable>
      </View>

      {!!activeError ? (
        <Text style={styles.errorText}>{activeError}</Text>
      ) : !!helperText ? (
        <Text style={styles.helperText}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 13,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
  },
  required: {
    color: "#DC2626",
  },
  fieldWrap: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 14,
    paddingRight: 10,
  },
  fieldWrapDisabled: {
    backgroundColor: "#F8FAFC",
    borderColor: "#E5E7EB",
  },
  fieldWrapError: {
    borderColor: "#DC2626",
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: "#111827",
    paddingVertical: 13,
  },
  iconWrap: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  helperText: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 17,
    color: "#6B7280",
  },
  errorText: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 17,
    color: "#DC2626",
    fontWeight: "700",
  },
});