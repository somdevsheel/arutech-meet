export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  MeetingList: undefined;
  PreJoin: { code: string };
  MeetingRoom: {
    meetingId: string;
    meetingCode: string;
    title: string;
    token: string;
    livekitUrl: string;
    participantId: string;
    role: string;
  };
};
