import React from "react";
import { Modal, View, Text, StyleSheet, TouchableOpacity } from "react-native";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function KaiModal({ visible, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.modal}>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Kai</Text>
            <Text style={styles.subtitle}>Ownership Assistant</Text>
          </View>

          {/* Capture */}
          <Text style={styles.section}>Capture</Text>

          <TouchableOpacity style={styles.button}>
            <Text>Add Reminder</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button}>
            <Text>Add Quick Event</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button}>
            <Text>Add Loose Note</Text>
          </TouchableOpacity>

          {/* Suggestions */}
          <Text style={styles.section}>Kai noticed</Text>

          <Text style={styles.suggestion}>
            Add your first system to this asset
          </Text>

          <Text style={styles.suggestion}>
            Upload proof for a recent event
          </Text>

          {/* Close */}
          <TouchableOpacity onPress={onClose} style={styles.close}>
            <Text>Close</Text>
          </TouchableOpacity>

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)"
  },
  modal: {
    backgroundColor: "white",
    padding: 20,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16
  },
  header: {
    marginBottom: 16
  },
  title: {
    fontSize: 22,
    fontWeight: "600"
  },
  subtitle: {
    color: "#777"
  },
  section: {
    marginTop: 12,
    fontWeight: "600"
  },
  button: {
    paddingVertical: 10
  },
  suggestion: {
    paddingVertical: 6,
    color: "#444"
  },
  close: {
    marginTop: 20
  }
});