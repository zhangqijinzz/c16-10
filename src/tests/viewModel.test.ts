import { beforeEach, describe, expect, it } from 'vitest';
import { FrameSenseViewModel } from '../viewModel';
import { EMPTY_DOCUMENT, type FrameDocument, type ImageAsset } from '../model';
import type { FrameRepository } from '../repository';
import type { ImageService } from '../service';

class MemoryRepository implements FrameRepository {
  document: FrameDocument = structuredClone(EMPTY_DOCUMENT);
  fail = false;
  saves = 0;
  load() { return structuredClone(this.document); }
  save(document: FrameDocument) { if (this.fail) throw new Error('no storage'); this.saves += 1; this.document = structuredClone(document); }
}

class FakeImageService implements ImageService {
  asset: ImageAsset = { src: 'data:image/svg+xml,test', width: 1200, height: 800, name: 'test.svg' };
  readFile() { return Promise.resolve(this.asset); }
  demo() { return this.asset; }
}

describe('FrameSenseViewModel', () => {
  let repository: MemoryRepository;
  let vm: FrameSenseViewModel;
  beforeEach(() => { repository = new MemoryRepository(); vm = new FrameSenseViewModel(repository, new FakeImageService()); });

  it('initializes empty and loads a demo image', async () => {
    await vm.initialize();
    expect(vm.getSnapshot().phase).toBe('ready');
    vm.loadDemo();
    expect(vm.getSnapshot().document.image?.name).toBe('test.svg');
    expect(repository.document.image).not.toBeNull();
  });

  it('updates guides, subject, ratio, and variants', () => {
    vm.loadDemo();
    vm.toggleGuide('center');
    vm.markSubject(0.2, 0.8);
    vm.setRatio('1:1');
    vm.saveVariant();
    expect(vm.getSnapshot().document.guides.center).toBe(true);
    expect(vm.getSnapshot().document.subject).toEqual({ x: 0.2, y: 0.8 });
    expect(vm.getSnapshot().document.crop.ratio).toBe('1:1');
    expect(vm.getSnapshot().document.variants).toHaveLength(1);
  });

  it('keeps edits in memory and reports persistence failure', () => {
    repository.fail = true;
    vm.loadDemo();
    expect(vm.getSnapshot().phase).toBe('error');
    expect(vm.getSnapshot().document.image).not.toBeNull();
    expect(vm.getSnapshot().error).toContain('没有保存到本地');
    expect(vm.getSnapshot().pendingSave).toContain('示例图片已载入');
  });

  it('previews drags in memory and commits exactly once on release', () => {
    vm.loadDemo();
    const savesBeforeDrag = repository.saves;
    vm.previewResizeCrop(0.5, 0.5);
    vm.previewMoveCrop(0.2, 0.1);
    vm.previewMoveCrop(0.05, 0.05);
    // 拖动过程中不产生任何落盘写入
    expect(repository.saves).toBe(savesBeforeDrag);
    expect(repository.document.crop).not.toEqual(vm.getSnapshot().document.crop);
    vm.commitCrop('move');
    // 松手后只提交一次，且落盘内容与屏幕画面一致
    expect(repository.saves).toBe(savesBeforeDrag + 1);
    expect(repository.document).toEqual(vm.getSnapshot().document);
  });

  it('keeps disk in sync with the screen across consecutive drags', () => {
    vm.loadDemo();
    vm.previewResizeCrop(0.5, 0.5);
    vm.commitCrop('resize');
    vm.previewMoveCrop(0.2, 0.2);
    vm.previewMoveCrop(-0.1, 0.05);
    vm.commitCrop('move');
    vm.previewResizeCrop(0.4, 0.4);
    vm.commitCrop('resize');
    expect(repository.document).toEqual(vm.getSnapshot().document);
  });

  it('names the failed change and retries with the current screen state', () => {
    vm.loadDemo();
    repository.fail = true;
    vm.previewResizeCrop(0.5, 0.5);
    vm.commitCrop('resize');
    // 失败要能说明是哪一次改动没存下来，且画面内容不丢
    expect(vm.getSnapshot().phase).toBe('error');
    expect(vm.getSnapshot().pendingSave).toContain('裁切范围已调整');
    expect(vm.getSnapshot().error).toContain('裁切范围已调整');
    expect(vm.getSnapshot().document.crop.width).toBe(0.5);
    expect(repository.document.crop.width).toBe(1);
    // 失败后又继续编辑，重试落盘的应是当前屏幕上的最新内容
    vm.previewMoveCrop(0.2, 0.1);
    repository.fail = false;
    vm.retrySave();
    expect(vm.getSnapshot().phase).toBe('editing');
    expect(vm.getSnapshot().pendingSave).toBeNull();
    expect(vm.getSnapshot().error).toBeNull();
    expect(repository.document).toEqual(vm.getSnapshot().document);
  });

  it('keeps the failure visible when a retry still cannot save', () => {
    vm.loadDemo();
    repository.fail = true;
    vm.previewMoveCrop(0.1, 0.1);
    vm.commitCrop('move');
    vm.retrySave();
    expect(vm.getSnapshot().phase).toBe('error');
    expect(vm.getSnapshot().pendingSave).toContain('裁切位置已调整');
    expect(vm.getSnapshot().error).toContain('仍未保存成功');
  });
});
