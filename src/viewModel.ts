import { useState, useSyncExternalStore } from 'react';
import { cropForRatio, makeVariant } from './domain';
import { EMPTY_DOCUMENT, type CropVariant, type FrameDocument, type GuideKey, type Ratio, type ViewState } from './model';
import type { FrameRepository } from './repository';
import type { ImageService } from './service';

type Listener = () => void;

export class FrameSenseViewModel {
  private state: ViewState = { phase: 'loading', document: structuredClone(EMPTY_DOCUMENT), compareOpen: false, notice: '', error: null, canRetrySave: false };
  private readonly listeners = new Set<Listener>();
  /** 最近一次未能落盘的改动说明，用于错误提示与重试。 */
  private failedSave: string | null = null;

  constructor(private readonly repository: FrameRepository, private readonly imageService: ImageService) {}

  getSnapshot = (): ViewState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private patch(next: Partial<ViewState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }

  private persist(document: FrameDocument, notice: string): void {
    this.patch({ document, phase: 'editing', notice, error: null, canRetrySave: false });
    try {
      this.repository.save(document);
      this.failedSave = null;
    } catch {
      this.failedSave = notice;
      this.patch({ phase: 'error', error: `本地保存失败：「${notice}」这次改动没有写入本地存储，内容仍保留在页面中，可点击重试。`, canRetrySave: true });
    }
  }

  retrySave(): void {
    if (this.failedSave === null) return;
    const label = this.failedSave;
    try {
      this.repository.save(this.state.document);
      this.failedSave = null;
      this.patch({ phase: 'editing', notice: `已重新保存：${label}`, error: null, canRetrySave: false });
    } catch {
      this.patch({ phase: 'error', error: `本地保存失败：「${label}」仍未写入，请检查浏览器存储权限后再次重试。`, canRetrySave: true });
    }
  }

  async initialize(): Promise<void> {
    this.patch({ phase: 'loading', notice: '正在恢复上次工作状态…', error: null, canRetrySave: false });
    try {
      const document = this.repository.load();
      this.patch({ document, phase: document.image ? 'editing' : 'ready', notice: document.image ? '已恢复上次工作状态' : '欢迎来到 FrameSense，先载入示例或导入图片。' });
    } catch {
      this.patch({ phase: 'error', notice: '未能读取历史状态，可继续新建工作。', error: '本地数据读取失败。' });
    }
  }

  async importImage(file: File): Promise<void> {
    this.patch({ phase: 'loading', notice: '正在载入图片…', error: null, canRetrySave: false });
    try {
      const image = await this.imageService.readFile(file);
      const document: FrameDocument = { ...structuredClone(EMPTY_DOCUMENT), image };
      this.persist(document, '图片已载入，可以开始构图。');
    } catch (error) {
      this.patch({ phase: 'error', error: error instanceof Error ? error.message : '图片载入失败。', canRetrySave: false });
    }
  }

  loadDemo(): void {
    this.persist({ ...structuredClone(EMPTY_DOCUMENT), image: this.imageService.demo() }, '示例图片已载入。');
  }

  toggleGuide(guide: GuideKey): void {
    const document = { ...this.state.document, guides: { ...this.state.document.guides, [guide]: !this.state.document.guides[guide] } };
    this.persist(document, '辅助层已更新。');
  }

  setRatio(ratio: Ratio): void {
    const image = this.state.document.image;
    if (!image) return;
    const crop = cropForRatio(ratio, image.width / image.height, this.state.document.crop);
    this.persist({ ...this.state.document, crop }, `${ratio === 'free' ? '自由' : ratio} 裁切已应用。`);
  }

  /** 拖动过程中的临时预览：只更新画面，不写本地存储。 */
  previewCrop(crop: CropVariant): void {
    this.patch({ document: { ...this.state.document, crop }, notice: '正在调整裁切，松开后自动保存…' });
  }

  /** 拖动结束后统一提交一次：落盘的内容就是屏幕上看到的状态。 */
  commitCrop(): void {
    this.persist(this.state.document, '裁切已调整。');
  }

  markSubject(x: number, y: number): void {
    this.persist({ ...this.state.document, subject: { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } }, '主体标记已更新。');
  }

  saveVariant(): void {
    const id = `variant-${Date.now()}`;
    const variant = makeVariant(this.state.document.crop, id);
    const document = { ...this.state.document, variants: [...this.state.document.variants, variant].slice(-8) };
    this.persist(document, `已保存裁切方案 ${document.variants.length}。`);
  }

  selectVariant(id: string): void {
    const variant = this.state.document.variants.find((item) => item.id === id);
    if (!variant) return;
    this.persist({ ...this.state.document, crop: { ...variant, id: 'current' } }, '已切换到保存的裁切方案。');
  }

  toggleCompare(): void {
    this.patch({ compareOpen: !this.state.compareOpen });
  }
}

export function useFrameSenseViewModel(repository: FrameRepository, imageService: ImageService): [FrameSenseViewModel, ViewState] {
  const [viewModel] = useState(() => new FrameSenseViewModel(repository, imageService));
  const state = useSyncExternalStore(viewModel.subscribe, viewModel.getSnapshot, viewModel.getSnapshot);
  return [viewModel, state];
}
