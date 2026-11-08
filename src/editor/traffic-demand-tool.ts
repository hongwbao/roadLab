import { copy, isSink, isSource } from "../core/types";
import {
  destinationShares,
  entryPercent,
  MAX_ENTRY_PERCENT,
  setDestinationPercent,
  setTrafficBaseRate,
  sourceDemandRate,
  trafficBaseRate,
  trafficPortKey,
  type PortReference,
} from "../core/traffic-demand";
import { TrafficDemandOverlay } from "../render/traffic-demand-overlay";
import type { Editor } from "./editor";
import { Vector2 } from "three";
export class TrafficDemandTool {
  private viewport = new Vector2();
  readonly overlay = new TrafficDemandOverlay();
  selected?: PortReference;
  target?: PortReference;
  onVisualChange = () => {};
  constructor(private editor: Editor) {
    editor.scene.scene.add(this.overlay.group);
  }
  get project() {
    return this.editor.project;
  }
  get sources() {
    return this.project.ports.filter(isSource);
  }
  get source() {
    return this.sources.find(
      (p) =>
        this.selected && trafficPortKey(p) === trafficPortKey(this.selected),
    );
  }
  get shares() {
    return this.source ? destinationShares(this.project, this.source) : [];
  }
  get percent() {
    return this.source ? entryPercent(this.project, this.source) : 100;
  }
  get rate() {
    return this.source ? sourceDemandRate(this.project, this.source) : 0;
  }
  sync() {
    if (this.editor.tool !== "boundary") {
      this.overlay.hide();
      return;
    }
    if (!this.source)
      this.selected = this.sources[0] && {
        road: this.sources[0].road,
        end: this.sources[0].end,
      };
    if (
      !this.shares.some(
        (d) =>
          this.target && trafficPortKey(d.port) === trafficPortKey(this.target),
      )
    )
      this.target = this.shares[0]?.port;
    this.overlay.show(this.project, this.source, this.target);
    this.onVisualChange();
  }
  choose(index: number) {
    const p = this.project.ports[index];
    if (!p || !isSource(p)) return;
    this.selected = { road: p.road, end: p.end };
    this.target = undefined;
    this.sync();
    this.editor.onChange();
  }
  chooseReference(ref: PortReference) {
    const index = this.project.ports.findIndex(
      (p) => trafficPortKey(p) === trafficPortKey(ref),
    );
    this.choose(index);
  }
  chooseTarget(index: number) {
    const p = this.project.ports[index];
    if (
      !p ||
      !isSink(p) ||
      !this.shares.some((d) => trafficPortKey(d.port) === trafficPortKey(p))
    )
      return;
    this.target = { road: p.road, end: p.end };
    this.sync();
  }
  private change(fn: () => void) {
    const before = copy(this.project);
    try {
      fn();
      if (JSON.stringify(before) !== JSON.stringify(this.project)) {
        this.editor.history.commit(before);
        this.editor.queueSave();
      }
      this.sync();
      this.editor.onChange();
    } catch (e) {
      this.editor.onToast((e as Error).message);
      this.editor.onChange();
    }
  }
  setPercent(percent: number) {
    this.change(() => {
      if (
        !Number.isFinite(percent) ||
        percent < 0 ||
        percent > MAX_ENTRY_PERCENT
      )
        throw new Error("入口比例须为0–1000%。");
      if (this.source)
        this.source.rate = (trafficBaseRate(this.project) * percent) / 100;
    });
  }
  setShare(index: number, percent: number) {
    this.change(() => {
      const p = this.project.ports[index];
      if (p && this.source)
        setDestinationPercent(this.project, this.source, p, percent);
    });
  }
  reset() {
    this.change(() => {
      if (this.source) delete this.source.destinations;
    });
  }
  setBase(rate: number) {
    this.change(() => setTrafficBaseRate(this.project, rate));
  }
  close() {
    this.editor.setTool("select");
  }
  updateView() {
    if (this.editor.tool === "boundary")
      this.overlay.updateView(
        this.editor.scene.camera,
        this.editor.scene.renderer.getSize(this.viewport),
      );
  }
}
