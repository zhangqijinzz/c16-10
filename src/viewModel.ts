import { useState, useSyncExternalStore } from 'react';
import { cropForRatio, makeVariant, moveCrop, resizeCrop } from './domain';
import { EMPTY_DOCUMENT, type FrameDocument, type GuideKey, type Ratio, type ViewState } from './model';
import type { FrameRepository } from './repository';
import type { ImageService } from './service';

type Listener = () => void;

/** 把通知文案转成可以嵌进句子的改动名称（去掉结尾句号）。 */
const changeLabel = (notice: string): string => notice.replace(/。$/, '');

export class FrameSenseViewModel {
  private state: ViewState = { phase: 'loading', document: structuredClone(EMPTY_DOCUMENT), compareOpen: false, notice: '', error: null, pendingSave: null };
  private readonly listeners = new Set<Listener>();

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

  /**
   * 提交一次改动：先更新画面，再把完整文档落盘一次。
   * 拖动这类高频更新不要走这里——用 preview 系列，松手后调 commitCrop 统一提交。
   */
  private commit(document: FrameDocument, notice: string): void {
    this.patch({ document, phase: 'editing', notice, error: null, pendingSave: null });
    try {
      this.repository.save(document);
    } catch {
      this.patch({
        phase: 'error',
        pendingSave: changeLabel(notice),
        error: `「${changeLabel(notice)}」这次改动没有保存到本地，当前画面内容仍保留在页面中，可重试保存。`,
      });
    }
  }

  /** 拖动过程中的瞬时更新：只改内存里的画面，不序列化、不写本地存储。 */
  private preview(document: FrameDocument): void {
    this.patch({ document, notice: '正在调整裁切，松手后自动保存。' });
  }

  /** 重试保存：落盘的始终是当前屏幕上的内容，而不是失败那一刻的旧快照。 */
  retrySave(): void {
    const pending = this.state.pendingSave;
    if (!pending) return;
    try {
      this.repository.save(this.state.document);
      this.patch({ phase: 'editing', notice: `「${pending}」已重新保存成功。`, error: null, pendingSave: null });
    } catch {
      this.patch({ phase: 'error', error: `「${pending}」重试后仍未保存成功，请检查浏览器存储空间或权限。` });
    }
  }

  async initialize(): Promise<void> {
    this.patch({ phase: 'loading', notice: '正在恢复上次工作状态…', error: null });
    try {
      const document = this.repository.load();
      this.patch({ document, phase: document.image ? 'editing' : 'ready', notice: document.image ? '已恢复上次工作状态' : '欢迎来到 FrameSense，先载入示例或导入图片。' });
    } catch {
      this.patch({ phase: 'error', notice: '未能读取历史状态，可继续新建工作。', error: '本地数据读取失败。' });
    }
  }

  async importImage(file: File): Promise<void> {
    this.patch({ phase: 'loading', notice: '正在载入图片…', error: null });
    try {
      const image = await this.imageService.readFile(file);
      const document: FrameDocument = { ...structuredClone(EMPTY_DOCUMENT), image };
      this.commit(document, '图片已载入，可以开始构图。');
    } catch (error) {
      this.patch({ phase: 'error', error: error instanceof Error ? error.message : '图片载入失败。' });
    }
  }

  loadDemo(): void {
    this.commit({ ...structuredClone(EMPTY_DOCUMENT), image: this.imageService.demo() }, '示例图片已载入。');
  }

  toggleGuide(guide: GuideKey): void {
    const document = { ...this.state.document, guides: { ...this.state.document.guides, [guide]: !this.state.document.guides[guide] } };
    this.commit(document, '辅助层已更新。');
  }

  setRatio(ratio: Ratio): void {
    const image = this.state.document.image;
    if (!image) return;
    const crop = cropForRatio(ratio, image.width / image.height, this.state.document.crop);
    this.commit({ ...this.state.document, crop }, `${ratio === 'free' ? '自由' : ratio} 裁切已应用。`);
  }

  previewMoveCrop(dx: number, dy: number): void {
    this.preview({ ...this.state.document, crop: moveCrop(this.state.document.crop, dx, dy) });
  }

  previewResizeCrop(width: number, height: number): void {
    this.preview({ ...this.state.document, crop: resizeCrop(this.state.document.crop, width, height) });
  }

  /** 一次拖动结束（松手/取消）后统一提交：把屏幕上的最终状态落盘一次。 */
  commitCrop(kind: 'move' | 'resize'): void {
    this.commit(this.state.document, kind === 'move' ? '裁切位置已调整。' : '裁切范围已调整。');
  }

  markSubject(x: number, y: number): void {
    this.commit({ ...this.state.document, subject: { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } }, '主体标记已更新。');
  }

  saveVariant(): void {
    const id = `variant-${Date.now()}`;
    const variant = makeVariant(this.state.document.crop, id);
    const document = { ...this.state.document, variants: [...this.state.document.variants, variant].slice(-8) };
    this.commit(document, `已保存裁切方案 ${document.variants.length}。`);
  }

  selectVariant(id: string): void {
    const variant = this.state.document.variants.find((item) => item.id === id);
    if (!variant) return;
    this.commit({ ...this.state.document, crop: { ...variant, id: 'current' } }, '已切换到保存的裁切方案。');
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
