import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getBezierPath,
} from "@xyflow/react";

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
  const activeIncoming = data.focusedRelationIds ? incoming.filter((port) => data.focusedRelationIds.has(port.id)) : incoming;
  const activeOutgoing = data.focusedRelationIds ? outgoing.filter((port) => data.focusedRelationIds.has(port.id)) : outgoing;
  return (
    <article className={`entity-node status-${entity.status} ${selected || data.focused ? "is-focused" : ""} ${data.dimmed ? "is-dimmed" : ""}`}>
      {activeIncoming.length ? <span className="port-axis port-axis--in">IN · {activeIncoming.length}</span> : null}
      {activeOutgoing.length ? <span className="port-axis port-axis--out">OUT · {activeOutgoing.length}</span> : null}
      {incoming.map((port, index) => <Port key={port.id} side="in" port={port} index={index} total={incoming.length} active={!data.focusedRelationIds || data.focusedRelationIds.has(port.id)} />)}
      {outgoing.map((port, index) => <Port key={port.id} side="out" port={port} index={index} total={outgoing.length} active={!data.focusedRelationIds || data.focusedRelationIds.has(port.id)} />)}
      <header>
        <span className="entity-status"><i />{statusLabels[entity.status] || entity.status}</span>
        {data.activeWork ? <span className="live-badge">в работе</span> : null}
      </header>
      <strong>{data.label}</strong>
      <p>{entity.purpose || entity.note || "Смысловая сущность проекта"}</p>
      <small>{entity.path || "логический блок"}</small>
    </article>
  );
});

export const AreaNode = memo(function AreaNode({ data, selected }) {
  return (
    <section className={`area-node ${selected ? "is-selected" : ""} ${data.dimmed ? "is-dimmed" : ""}`}>
      <header className="area-drag-handle">
        <span><small>ОБЛАСТЬ · {data.count}</small><strong>{data.label}</strong></span>
        <p>{data.area.note}</p>
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
  const [path, labelX, labelY] = getBezierPath({ ...props, curvature: 0.32 });
  const active = props.data?.focused;
  return (
    <>
      <BaseEdge {...props} path={path} className={`${props.className || ""} ${active ? "is-focused" : ""} ${props.data?.dimmed ? "is-dimmed" : ""}`} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`edge-label nodrag nopan ${active ? "is-focused" : ""} ${props.data?.dimmed ? "is-dimmed" : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          title={`${props.label} · двойной клик для переименования`}
          onDoubleClick={(event) => { event.stopPropagation(); props.data?.onRename?.(); }}
        >
          {props.label}
        </button>
      </EdgeLabelRenderer>
    </>
  );
});

export const WorkEdge = memo(function WorkEdge(props) {
  const [path] = getBezierPath(props);
  return <BaseEdge {...props} path={path} className={`work-edge ${props.data?.dimmed ? "is-dimmed" : ""}`} />;
});

export const nodeTypes = { entity: EntityNode, area: AreaNode, work: WorkNode };
export const edgeTypes = { semantic: SemanticEdge, work: WorkEdge };
