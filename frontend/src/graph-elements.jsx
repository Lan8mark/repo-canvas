import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getBezierPath,
} from "@xyflow/react";
import { orthogonalRelationPath } from "./edge-routing.js";

const statusLabels = {
  operational: "работает",
  planned: "план",
  problem: "проблема",
  disabled: "отключено",
};

function Port({ side, port, index, total, active }) {
  const top = `${24 + ((index + 1) / (total + 1)) * 68}%`;
  const incoming = side === "in";
  return (
    <div className={`node-port node-port--${side} ${active ? "is-active" : "is-muted"}`} style={{ top }} title={`${incoming ? "Вход" : "Выход"}: ${port.label}`}>
      <Handle
        id={`${side}:${port.id}`}
        type={incoming ? "target" : "source"}
        position={incoming ? Position.Left : Position.Right}
        className={`semantic-handle semantic-handle--${side}`}
      />
    </div>
  );
}

export const EntityNode = memo(function EntityNode({ data, selected }) {
  const { entity, incoming = [], outgoing = [] } = data;
  const logical = data.layer !== "technical";
  const goal = entity.goal || entity.problem || "Цель этого блока пока не сформулирована.";
  const solution = entity.solution || entity.purpose || "Роль блока пока не сформулирована.";
  const mechanism = entity.mechanism || entity.note || entity.purpose || "Технический механизм пока не описан.";
  return (
    <article
      className={`entity-node role-${data.role || "core"} status-${entity.status} ${selected || data.focused ? "is-focused" : ""} ${data.dimmed ? "is-dimmed" : ""} ${data.showAreaContext ? "has-area-context" : ""}`}
      style={{
        "--area-color": data.areaColor,
        "--importance": Math.max(1, Math.min(100, Number(data.weight) || 50)) / 100,
      }}
    >
      {incoming.map((port, index) => <Port key={port.id} side="in" port={port} index={index} total={incoming.length} active={!data.focusedRelationIds || data.focusedRelationIds.has(port.id)} />)}
      {outgoing.map((port, index) => <Port key={port.id} side="out" port={port} index={index} total={outgoing.length} active={!data.focusedRelationIds || data.focusedRelationIds.has(port.id)} />)}
      <header>
        <span className="entity-status"><i />{statusLabels[entity.status] || entity.status}</span>
        <span className="entity-meta">
          {data.showAreaContext ? <span className="area-context" title={`Область: ${data.areaLabel}`}><i />{data.areaLabel}</span> : null}
          {data.activeWork ? <span className="live-badge">в работе</span> : null}
        </span>
      </header>
      <strong>{data.label}</strong>
      {logical ? <div className="node-narrative">
        <p className="node-problem"><b>Цель</b><span>{goal}</span></p>
        <p className="node-solution"><b>Решение</b><span>{solution}</span></p>
      </div> : <div className="node-technical">
        <p>{mechanism}</p>
        {entity.invariants?.[0] ? <p className="node-invariant"><b>Гарантия</b><span>{entity.invariants[0]}</span></p> : null}
        <small>{entity.path || "путь не указан"}</small>
      </div>}
    </article>
  );
});

export const AreaNode = memo(function AreaNode({ data, selected }) {
  const logical = data.layer !== "technical";
  return (
    <section className={`area-node ${selected ? "is-selected" : ""} ${data.dimmed ? "is-dimmed" : ""}`}>
      {[Position.Top, Position.Right, Position.Bottom, Position.Left].flatMap((position) => {
        const side = position.toLowerCase();
        return [
          <Handle key={`source:${side}`} id={`area-source:${side}`} type="source" position={position} className="area-link-handle" />,
          <Handle key={`target:${side}`} id={`area-target:${side}`} type="target" position={position} className="area-link-handle" />,
        ];
      })}
      <header className="area-drag-handle">
        <span><small>ОБЛАСТЬ · {data.count}</small><strong>{data.label}</strong></span>
        <div className="area-copy">
          {logical ? <>
            <p><b>Цель</b>{data.area.goal || data.area.problem || data.area.note}</p>
            {data.area.solution ? <p><b>Решение</b>{data.area.solution}</p> : null}
          </> : <p>{data.area.note || data.area.solution || "Техническая граница области"}</p>}
        </div>
      </header>
    </section>
  );
});

export const WorkNode = memo(function WorkNode({ data, selected }) {
  const { work } = data;
  const state = work.provisional ? "осмысляет" : work.status === "active" ? "в работе" : work.status === "blocked" ? "ждёт" : "план";
  return (
    <article className={`work-node status-${work.status} ${work.provisional ? "is-provisional" : ""} ${selected ? "is-selected" : ""} ${data.dimmed ? "is-dimmed" : ""}`}>
      <Handle id="out" type="source" position={Position.Bottom} className="work-source-handle" />
      <i className="work-pulse" />
      <span><small>{work.actor || "agent"} · {state}</small><strong>{work.title}</strong></span>
      <b>↗</b>
    </article>
  );
});

export const SemanticEdge = memo(function SemanticEdge(props) {
  const { path, labelX, labelY, labelWidth } = orthogonalRelationPath({ ...props, label: props.label });
  const active = props.data?.focused;
  return (
    <>
      <BaseEdge {...props} path={path} className={`${props.className || ""} ${active ? "is-focused" : ""} ${props.data?.dimmed ? "is-dimmed" : ""}`} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`edge-label nodrag nopan ${active ? "is-focused" : ""} ${props.data?.dimmed ? "is-dimmed" : ""}`}
          style={{
            maxWidth: `${labelWidth}px`,
            transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY - 7}px)`,
          }}
          title={`${props.label} · двойной клик для переименования`}
          onDoubleClick={(event) => { event.stopPropagation(); props.data?.onRename?.(); }}
        >
          {props.label}
        </button>
      </EdgeLabelRenderer>
    </>
  );
});

export const AreaLinkEdge = memo(function AreaLinkEdge(props) {
  const [path] = getBezierPath({ ...props, curvature: 0.2 });
  return <BaseEdge
    {...props}
    path={path}
    interactionWidth={18}
    className={`area-link-edge ${props.data?.dimmed ? "is-dimmed" : ""}`}
    onClick={(event) => { event.stopPropagation(); props.data?.onOpen?.(); }}
  />;
});

export const WorkEdge = memo(function WorkEdge(props) {
  const [path] = getBezierPath(props);
  return <BaseEdge {...props} path={path} className={`work-edge ${props.data?.dimmed ? "is-dimmed" : ""}`} />;
});

export const nodeTypes = { entity: EntityNode, area: AreaNode, work: WorkNode };
export const edgeTypes = { semantic: SemanticEdge, areaLink: AreaLinkEdge, work: WorkEdge };
