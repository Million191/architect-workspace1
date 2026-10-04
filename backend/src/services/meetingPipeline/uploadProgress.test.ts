import { UploadProgressTracker } from './uploadProgress';

describe('UploadProgressTracker', () => {
  it('maps real pipeline stages to the phases shown on the page', () => {
    const t = new UploadProgressTracker();
    t.start('upload-0001');
    expect(t.get('upload-0001')?.phase).toBe('uploading');
    t.stage('upload-0001', 'transcription');
    expect(t.get('upload-0001')?.phase).toBe('transcribing');
    t.stage('upload-0001', 'discussion summary');
    expect(t.get('upload-0001')).toMatchObject({ phase: 'analyzing', stage: 'discussion summary' });
    t.stage('upload-0001', 'action item extraction');
    expect(t.get('upload-0001')?.phase).toBe('extracting');
    t.finish('upload-0001', 'done');
    expect(t.get('upload-0001')?.phase).toBe('done');
  });

  it('ignores unknown uploads and drops finished entries after ten minutes', () => {
    let now = Date.parse('2026-10-04T00:00:00Z');
    const t = new UploadProgressTracker(() => now);
    t.stage('missing-id', 'transcription');
    expect(t.get('missing-id')).toBeUndefined();
    t.start('upload-0002');
    t.finish('upload-0002', 'failed');
    now += 11 * 60 * 1000;
    t.start('upload-0003'); // starting a new upload prunes old finished ones
    expect(t.get('upload-0002')).toBeUndefined();
    expect(t.get('upload-0003')?.phase).toBe('uploading');
  });
});
