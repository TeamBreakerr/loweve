// 点评室录音接口。上传走 XHR：fetch 拿不到上传进度，长讨论的录音可能几十 MB。
import { api, withViewing } from './index';
import type { ReviewRecording, SpeakerMap } from '../types';

export async function listRecordings(sessionId: number): Promise<ReviewRecording[]> {
  return (await api(`/api/sessions/${sessionId}/recordings`)).recordings;
}

export function uploadRecording(sessionId: number, blob: Blob, durationMs: number, onProgress?: (ratio: number) => void): Promise<ReviewRecording> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withViewing(`/api/sessions/${sessionId}/recordings`));
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', blob.type || 'audio/webm');
    xhr.setRequestHeader('X-Duration-Ms', String(Math.round(durationMs)));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let body: any = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* 非 JSON 错误页 */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(Object.assign(new Error(body.error || xhr.statusText), { status: xhr.status, body }));
    };
    xhr.onerror = () => reject(Object.assign(new Error('upload_network'), { status: 0, body: { error: 'upload_network' } }));
    xhr.send(blob);
  });
}

export function retryRecording(id: number): Promise<ReviewRecording> {
  return api(`/api/recordings/${id}/retry`, { method: 'POST' });
}

export function regenerateRecording(id: number, speakerMap: SpeakerMap | null): Promise<ReviewRecording> {
  return api(`/api/recordings/${id}/regenerate`, { method: 'POST', body: JSON.stringify({ speaker_map: speakerMap }) });
}
