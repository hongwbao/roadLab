import { buildLaneJunctions } from "../core/lane-junctions";
import { connections } from "../core/model";
import {
  junctionLaneKey,
  junctionLaneLayout,
  junctionLaneRule,
  restoreJunctionLaneRule,
  restoreJunctionLaneRules,
  setJunctionLaneRule,
  type JunctionLaneEndpoint,
  type JunctionLaneLayout,
} from "../core/junction-lane-connections";
import {
  JunctionLaneOverlay,
  type JunctionLaneHit,
} from "../render/junction-lane-overlay";
import type { Editor } from "./editor";

export class JunctionLaneTool {
  readonly overlay = new JunctionLaneOverlay();
  selected?: string;
  selectedFrom?: JunctionLaneEndpoint;
  selectedConnection?: string;
  layout?: JunctionLaneLayout;
  private signature = "";
  private hover?: JunctionLaneHit;
  constructor(private editor: Editor) {
    editor.scene.scene.add(this.overlay.group);
  }
  get junction() {
    return buildLaneJunctions(this.editor.project).find(
      (j) =>
        j.id === this.selected &&
        (j.arms.length >= 3 || j.kind === "attachment"),
    );
  }
  get ports() {
    return this.layout?.ports ?? [];
  }
  get source() {
    return this.layout?.ports.find(
      (p) => this.selectedFrom && p.key === junctionLaneKey(this.selectedFrom),
    );
  }
  get rule() {
    return this.selectedFrom
      ? junctionLaneRule(this.editor.project, this.selectedFrom)
      : undefined;
  }
  get destinations() {
    return (
      this.layout?.links.filter((link) => link.from.key === this.source?.key) ??
      []
    );
  }
  get selectedLink() {
    return this.layout?.links.find(
      (link) => link.id === this.selectedConnection,
    );
  }
  sync() {
    if (this.editor.tool !== "turn") {
      this.overlay.group.visible = false;
      this.hover = undefined;
      return;
    }
    const junction = this.junction;
    if (!junction) {
      this.selected = undefined;
      this.selectedFrom = undefined;
      this.selectedConnection = undefined;
      this.layout = undefined;
      this.signature = "";
      this.overlay.rebuild();
      return;
    }
    const roads = new Set(junction.arms.map((a) => a.road)),
      signature = JSON.stringify([
        junction,
        this.editor.project.roads.filter((r) => roads.has(r.id)),
        this.editor.project.junctionLaneConnections,
        this.editor.project.signals,
      ]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.layout = junctionLaneLayout(
        this.editor.project,
        junction,
        connections(this.editor.project),
      );
      if (
        this.selectedFrom &&
        !this.layout.ports.some(
          (p) =>
            p.kind === "in" && p.key === junctionLaneKey(this.selectedFrom!),
        )
      )
        this.selectedFrom = undefined;
      if (
        this.selectedConnection &&
        !this.layout.links.some((link) => link.id === this.selectedConnection)
      )
        this.selectedConnection = undefined;
      this.overlay.rebuild(this.layout);
    }
    this.overlay.group.visible = true;
    this.overlay.setState(
      this.selectedFrom,
      this.hover,
      this.selectedConnection,
    );
  }
  private junctionHit(x: number, y: number) {
    return buildLaneJunctions(this.editor.project)
      .filter((j) => j.arms.length >= 3 || j.kind === "attachment")
      .map((j) => {
        const p = this.editor.scene.project(j.position),
          edge = this.editor.scene.project({
            ...j.position,
            x: j.position.x + j.radius,
          });
        return {
          junction: j,
          distance: Math.hypot(x - p.x, y - p.y),
          radius: Math.max(22, Math.hypot(p.x - edge.x, p.y - edge.y)),
        };
      })
      .filter((j) => j.distance <= j.radius)
      .sort((a, b) => a.distance - b.distance)[0]?.junction;
  }
  select(x: number, y: number) {
    const hit = this.overlay.hit(x, y, (p) => this.editor.scene.project(p));
    if (hit?.kind === "port") {
      if (hit.port.kind === "in") {
        this.selectedFrom = {
          road: hit.port.road,
          lane: hit.port.lane,
          end: hit.port.end,
        };
        this.selectedConnection = undefined;
        this.hover = hit;
        this.overlay.setState(this.selectedFrom, this.hover);
        this.overlay.previewTo();
        this.editor.onChange();
        return;
      }
      if (!this.selectedFrom) {
        this.editor.onToast("先点击一个实心入车道圆点，再选择出车道。");
        return;
      }
      const candidate = this.layout?.candidates.find(
        (link) =>
          link.from.key === junctionLaneKey(this.selectedFrom!) &&
          link.to.key === hit.port.key,
      );
      if (!candidate) {
        this.editor.onToast("这两个车道不能连接，请选择同层路口的其他出口。");
        return;
      }
      const enabled = this.destinations.some(
        (link) => link.id === candidate.id,
      );
      this.setDestination(hit.port, !enabled);
      return;
    }
    if (hit?.kind === "link") {
      this.selectedFrom = {
        road: hit.link.from.road,
        lane: hit.link.from.lane,
        end: hit.link.from.end,
      };
      this.selectedConnection = hit.link.id;
      this.hover = hit;
      this.overlay.setState(
        this.selectedFrom,
        this.hover,
        this.selectedConnection,
      );
      this.editor.onChange();
      return;
    }
    const junction = this.junctionHit(x, y);
    if (junction) {
      this.selected = junction.id;
      this.selectedFrom = undefined;
      this.selectedConnection = undefined;
      this.signature = "";
      this.hover = undefined;
      this.sync();
      this.editor.scene.showBuildMarker();
      this.editor.onChange();
      return;
    }
    if (this.selectedFrom) {
      this.selectedFrom = undefined;
      this.selectedConnection = undefined;
      this.overlay.setState();
      this.overlay.previewTo();
      this.editor.onChange();
    } else this.editor.onToast("请点击路口或偏移吸附接头，显示车道连线。");
  }
  move(x: number, y: number) {
    this.hover = this.overlay.hit(x, y, (p) => this.editor.scene.project(p));
    this.overlay.setState(
      this.selectedFrom,
      this.hover,
      this.selectedConnection,
    );
    if (this.selectedFrom) {
      const port =
          this.hover?.kind === "port" && this.hover.port.kind === "out"
            ? this.hover.port
            : undefined,
        ground = this.editor.scene.groundPoint(
          x,
          y,
          this.junction?.position.y ?? 0,
        );
      this.overlay.previewTo(port?.position ?? ground, port);
    } else if (!this.selected) {
      const junction = this.junctionHit(x, y);
      this.editor.scene.showBuildMarker(junction?.position, !!junction);
    }
  }
  clearHover() {
    this.hover = undefined;
    this.overlay.previewTo();
    this.overlay.setState(
      this.selectedFrom,
      undefined,
      this.selectedConnection,
    );
  }
  rightClick(x: number, y: number) {
    const hit = this.overlay.hit(x, y, (p) => this.editor.scene.project(p));
    if (hit?.kind === "link") {
      this.selectedFrom = {
        road: hit.link.from.road,
        lane: hit.link.from.lane,
        end: hit.link.from.end,
      };
      this.setDestination(hit.link.to, false);
      return true;
    }
    if (this.selectedFrom) {
      this.selectedFrom = undefined;
      this.selectedConnection = undefined;
      this.clearHover();
      this.editor.onChange();
      return true;
    }
    if (this.selected) {
      this.selected = undefined;
      this.signature = "";
      this.sync();
      this.editor.onChange();
      return true;
    }
    return false;
  }
  private setDestination(to: JunctionLaneEndpoint, enabled: boolean) {
    if (!this.selectedFrom || !this.layout) return;
    const from = { ...this.selectedFrom },
      destinations = this.destinations
        .filter((link) => link.to.key !== junctionLaneKey(to))
        .map((link) => ({
          road: link.to.road,
          lane: link.to.lane,
          end: link.to.end,
        }));
    if (enabled)
      destinations.push({ road: to.road, lane: to.lane, end: to.end });
    this.editor.edit(
      () => setJunctionLaneRule(this.editor.project, from, destinations),
      enabled ? "已添加车道连线，测试已重置" : "已移除此车道连线，测试已重置",
    );
    this.overlay.previewTo();
  }
  chooseSource(key: string) {
    const source = this.ports.find(
      (port) => port.kind === "in" && port.key === key,
    );
    if (!source) return;
    this.selectedFrom = {
      road: source.road,
      lane: source.lane,
      end: source.end,
    };
    this.selectedConnection = undefined;
    this.clearHover();
    this.editor.onChange();
  }
  toggleTarget(key: string) {
    if (!this.source) return;
    const link = this.layout?.candidates.find(
      (link) => link.from.key === this.source!.key && link.to.key === key,
    );
    if (link)
      this.setDestination(
        link.to,
        !this.destinations.some((row) => row.id === link.id),
      );
  }
  removeConnection(id: string) {
    const link = this.layout?.links.find((row) => row.id === id);
    if (!link) return;
    this.selectedFrom = {
      road: link.from.road,
      lane: link.from.lane,
      end: link.from.end,
    };
    this.setDestination(link.to, false);
  }
  deleteSelected() {
    if (this.editor.tool !== "turn") return false;
    if (this.selectedConnection) this.removeConnection(this.selectedConnection);
    else this.editor.onToast("先点击要删除的连线，或右键直接移除连线。");
    return true;
  }
  banLane() {
    if (!this.selectedFrom) return;
    const from = { ...this.selectedFrom };
    this.editor.edit(
      () => setJunctionLaneRule(this.editor.project, from, []),
      "此入车道已禁止所有出口",
    );
  }
  restoreLane() {
    if (!this.selectedFrom) return;
    const from = { ...this.selectedFrom };
    this.editor.edit(
      () => restoreJunctionLaneRule(this.editor.project, from),
      "此入车道已恢复自动连接",
    );
  }
  restoreJunction() {
    const junction = this.junction;
    if (junction)
      this.editor.edit(
        () => restoreJunctionLaneRules(this.editor.project, junction),
        "此路口已恢复自动连接",
      );
  }
  clearSelection() {
    this.selectedFrom = undefined;
    this.selectedConnection = undefined;
    this.clearHover();
    this.editor.onChange();
  }
  close() {
    this.editor.setTool("select");
  }
}
