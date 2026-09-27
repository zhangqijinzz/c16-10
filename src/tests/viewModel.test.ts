import { beforeEach, describe, expect, it } from 'vitest';
import { FrameSenseViewModel } from '../viewModel';
import { DEFAULT_CROP, EMPTY_DOCUMENT, type FrameDocument, type ImageAsset } from '../model';
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
    expect(vm.getSnapshot().error).toContain('本地保存失败');
  });

  it('previews crop drags without writing and commits exactly once on release', () => {
    vm.loadDemo();
    const savesBefore = repository.saves;
    vm.previewCrop({ ...DEFAULT_CROP, width: 0.5, height: 0.5, x: 0.1, y: 0.1 });
    vm.previewCrop({ ...DEFAULT_CROP, width: 0.5, height: 0.5, x: 0.2, y: 0.3 });
    expect(vm.getSnapshot().document.crop.x).toBe(0.2);
    expect(repository.document.crop.x).toBe(0);
    expect(repository.saves).toBe(savesBefore);
    vm.commitCrop();
    expect(repository.saves).toBe(savesBefore + 1);
    expect(repository.document.crop).toEqual(vm.getSnapshot().document.crop);
  });

  it('keeps storage identical to the screen after consecutive gestures', () => {
    vm.loadDemo();
    vm.previewCrop({ ...DEFAULT_CROP, width: 0.5, height: 0.5, x: 0.1, y: 0.1 });
    vm.commitCrop();
    vm.previewCrop({ ...DEFAULT_CROP, width: 0.4, height: 0.4, x: 0.2, y: 0.15 });
    vm.previewCrop({ ...DEFAULT_CROP, width: 0.4, height: 0.4, x: 0.5, y: 0.45 });
    vm.commitCrop();
    expect(repository.document.crop).toEqual(vm.getSnapshot().document.crop);
    expect(repository.document.crop.x).toBe(0.5);
  });

  it('names the failed change and retries the save', () => {
    vm.loadDemo();
    repository.fail = true;
    vm.previewCrop({ ...DEFAULT_CROP, width: 0.5, height: 0.5, x: 0.3, y: 0.4 });
    vm.commitCrop();
    expect(vm.getSnapshot().phase).toBe('error');
    expect(vm.getSnapshot().error).toContain('裁切已调整');
    expect(vm.getSnapshot().canRetrySave).toBe(true);
    expect(repository.document.crop.x).toBe(0);
    expect(vm.getSnapshot().document.crop.x).toBe(0.3);
    repository.fail = false;
    vm.retrySave();
    expect(vm.getSnapshot().phase).toBe('editing');
    expect(vm.getSnapshot().error).toBeNull();
    expect(vm.getSnapshot().canRetrySave).toBe(false);
    expect(repository.document.crop).toEqual(vm.getSnapshot().document.crop);
  });

  it('keeps the failed state when the retry also fails', () => {
    vm.loadDemo();
    repository.fail = true;
    vm.commitCrop();
    vm.retrySave();
    expect(vm.getSnapshot().phase).toBe('error');
    expect(vm.getSnapshot().canRetrySave).toBe(true);
    repository.fail = false;
    vm.retrySave();
    expect(vm.getSnapshot().phase).toBe('editing');
  });
});
