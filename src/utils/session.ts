export function getDeviceSessionId(): string {
  let id = localStorage.getItem('device_session_id');
  if (!id) {
    id = 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('device_session_id', id);
  }
  return id;
}
