import React from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ParticipantPresencePayload } from '@arutech/types';
import { colors } from '../../lib/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  participants: ParticipantPresencePayload[];
}

export function ParticipantsSheet({ visible, onClose, participants }: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>In this meeting — {participants.length}</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          <FlatList
            data={participants}
            keyExtractor={(p) => p.participantId}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Text style={styles.name}>{item.displayName}</Text>
                <Text style={styles.role}>{item.role}</Text>
              </View>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { height: '50%', backgroundColor: colors.surfaceRaised, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  close: { color: colors.brandLight, fontSize: 13 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { color: colors.text, fontSize: 14 },
  role: { color: colors.textMuted, fontSize: 12 },
});
