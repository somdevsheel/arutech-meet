import React, { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ChatMessagePayload } from '@arutech/types';
import { colors } from '../../lib/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  messages: ChatMessagePayload[];
  onSend: (body: string) => void;
}

export function ChatSheet({ visible, onClose, messages, onSend }: Props) {
  const [draft, setDraft] = useState('');

  function submit() {
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft('');
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Chat</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>

          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            style={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>No messages yet.</Text>}
            renderItem={({ item }) => (
              <View style={styles.message}>
                <Text style={styles.sender}>{item.senderName}</Text>
                <Text style={styles.body}>{item.body}</Text>
              </View>
            )}
          />

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Send a message"
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={submit}
            />
            <Pressable style={styles.sendButton} onPress={submit}>
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { height: '65%', backgroundColor: colors.surfaceRaised, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  close: { color: colors.brandLight, fontSize: 13 },
  list: { flex: 1 },
  empty: { color: colors.textMuted, fontSize: 13 },
  message: { marginBottom: 10 },
  sender: { color: colors.textMuted, fontSize: 11 },
  body: { color: colors.text, fontSize: 14, marginTop: 2 },
  inputRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: colors.text,
  },
  sendButton: { backgroundColor: colors.brand, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
