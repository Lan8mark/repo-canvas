import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { canvasApi, reloadToken } from "./api.js";
import { focusColumnOffset } from "./edge-routing.js";
import { LAYOUT_VERSION, activeWork, areaTitle, buildGraph, entityLabel, neighborSet } from "./graph.js";
import { edgeTypes, nodeTypes } from "./graph-elements.jsx";

function relativeTime(value) {
  if (!value) return "—";
  const delta = Math.max(0, Date.now() - new Date(value).getTime());
  if (delta < 10_000) return "сейчас";
  if (delta < 60_000) return `${Math.floor(delta / 1000)} сек`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} мин`;
  return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function Icon({ children }) { return <span aria-hidden="true">{children}</span>; }

function relationText(relation, layer) {
  if (layer === "technical") return relation?.technical || relation?.ownerLabel || relation?.label || "техническая связь";
  return relation?.ownerLabel || relation?.label || "связано";
}

export default function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedWorkId, setSelectedWorkId] = useState(null);
  const [selectedBridge, setSelectedBridge] = useState(null);
  const [direction, setDirection] = useState("all");
  const [informationLayer, setInformationLayer] = useState("logic");
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState(null);
  const [rename, setRename] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [update, setUpdate] = useState(null);
  const [layoutUnlocked, setLayoutUnlocked] = useState(false);
  const [initialFit, setInitialFit] = useState(false);
  const snapshotRef = useRef(null);
  const busyRef = useRef(false);
  const previousSelectedRef = useRef(null);
  const { fitView, getNodes, setCenter, zoomIn, zoomOut } = useReactFlow();

  const notify = useCallback((text, error = false) => {
    setMessage({ text, error });
    window.setTimeout(() => setMessage(null), 3200);
  }, []);

  const refresh = useCallback(async (force = true) => {
    if (busyRef.current) return;
    try {
      if (!force && snapshotRef.current) {
        const revision = await canvasApi.revision();
        if (revision.revision === snapshotRef.current.revision) { setOnline(true); return; }
      }
      const next = await canvasApi.state();
      snapshotRef.current = next;
      setSnapshot(next);
      setOnline(true);
    } catch (error) {
      setOnline(false);
      if (error.status === 401) notify("Canvas потерял локальный доступ", true);
    }
  }, [notify]);

  useEffect(() => {
    refresh(true);
    const timer = window.setInterval(() => refresh(false), 900);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const onStorage = () => { reloadToken(); refresh(true); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  useEffect(() => {
    if (!snapshot) return;
    let cancelled = false;
    buildGraph(snapshot).then((graph) => {
      if (cancelled) return;
      setNodes(graph.nodes);
      setEdges(graph.edges);
      if (!initialFit) {
        setInitialFit(true);
        window.setTimeout(() => fitView({ padding: 0.12, duration: 500 }), 80);
      }
    }).catch((error) => notify(`Не удалось построить карту: ${error.message}`, true));
    return () => { cancelled = true; };
  }, [snapshot, setNodes, setEdges, initialFit, fitView, notify]);

  useEffect(() => {
    const key = (event) => {
      if (event.key === "Escape") { setSelectedId(null); setSelectedWorkId(null); setSelectedBridge(null); }
      if (event.key === "F2" && selectedId && snapshot) {
        event.preventDefault();
        const entity = snapshot.entities.find((item) => item.id === selectedId);
        if (entity) setRename({ kind: "entity", id: entity.id, value: entityLabel(entity) });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selectedId, snapshot]);

  const selectedEntity = snapshot?.entities.find((entity) => entity.id === selectedId) || null;
  const selectedWork = snapshot?.work.find((work) => work.id === selectedWorkId) || null;
  const selectedArea = selectedEntity ? snapshot?.areas.find((area) => area.id === selectedEntity.areaId) : null;
  const currentWork = selectedEntity ? activeWork(snapshot).filter((work) => work.targets?.includes(selectedEntity.id)) : [];
  const incoming = selectedEntity ? snapshot.relations.filter((relation) => relation.to === selectedEntity.id) : [];
  const outgoing = selectedEntity ? snapshot.relations.filter((relation) => relation.from === selectedEntity.id) : [];

  const displayGraph = useMemo(() => {
    if (!snapshot) return { nodes, edges };
    const visible = selectedBridge
      ? new Set(selectedBridge.relations.flatMap((relation) => [relation.from, relation.to]))
      : neighborSet(snapshot, selectedId, direction);
    const hasFocus = Boolean(selectedId || selectedBridge);
    const focusRelationItems = selectedBridge
      ? selectedBridge.relations
      : (snapshot.relations || []).filter((relation) => {
          if (!selectedId) return false;
          if (direction === "in") return relation.to === selectedId;
          if (direction === "out") return relation.from === selectedId;
          return relation.from === selectedId || relation.to === selectedId;
        });
    const focusedRelations = new Set(focusRelationItems.map((relation) => `relation:${relation.id}`));
    const focusedRelationIds = new Set(focusRelationItems.map((relation) => relation.id));
    const activeIds = new Set(snapshot.activeEntityIds || []);
    const focusPositions = new Map();
    const columnOffset = focusColumnOffset(focusRelationItems.map((relation) => ({
      ...relation,
      label: relationText(relation, informationLayer),
      ownerLabel: undefined,
    })));

    const placeColumn = (ids, x, centerY, nodeById) => {
      const gap = 52;
      const heights = ids.map((id) => Number(nodeById.get(id)?.style?.height || nodeById.get(id)?.measured?.height || 136));
      const totalHeight = heights.reduce((sum, height) => sum + height, 0) + Math.max(0, ids.length - 1) * gap;
      let y = centerY - totalHeight / 2;
      ids.forEach((id, index) => {
        focusPositions.set(id, { x, y });
        y += heights[index] + gap;
      });
    };

    if (selectedBridge) {
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      const entityArea = new Map(snapshot.entities.map((entity) => [entity.id, entity.areaId]));
      const firstRelation = selectedBridge.relations[0];
      const leftAreaId = entityArea.get(firstRelation.from);
      const rightAreaId = entityArea.get(firstRelation.to);
      const leftIds = [...new Set(selectedBridge.relations.flatMap((relation) => [relation.from, relation.to]).filter((id) => entityArea.get(id) === leftAreaId))];
      const rightIds = [...new Set(selectedBridge.relations.flatMap((relation) => [relation.from, relation.to]).filter((id) => entityArea.get(id) === rightAreaId))];
      const leftAreaNode = nodeById.get(`area:${leftAreaId}`);
      const rightAreaNode = nodeById.get(`area:${rightAreaId}`);
      const anchor = {
        x: ((leftAreaNode?.position.x || 0) + (rightAreaNode?.position.x || 0)) / 2,
        y: ((leftAreaNode?.position.y || 0) + (rightAreaNode?.position.y || 0)) / 2,
      };
      placeColumn(leftIds, anchor.x - columnOffset / 2, anchor.y, nodeById);
      placeColumn(rightIds, anchor.x + columnOffset / 2, anchor.y, nodeById);
    } else if (selectedId) {
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      const selectedNode = nodeById.get(selectedId);
      const parentNode = selectedNode?.parentId ? nodeById.get(selectedNode.parentId) : null;
      const anchor = selectedNode ? {
        x: (parentNode?.position.x || 0) + selectedNode.position.x,
        y: (parentNode?.position.y || 0) + selectedNode.position.y,
      } : { x: 0, y: 0 };
      const left = [];
      const right = [];
      const placed = new Set([selectedId]);

      for (const relation of snapshot.relations || []) {
        if (!focusedRelations.has(`relation:${relation.id}`)) continue;
        if (relation.to === selectedId && !placed.has(relation.from)) {
          left.push(relation.from);
          placed.add(relation.from);
        } else if (relation.from === selectedId && !placed.has(relation.to)) {
          right.push(relation.to);
          placed.add(relation.to);
        }
      }

      focusPositions.set(selectedId, anchor);
      const selectedHeight = Number(selectedNode?.style?.height || selectedNode?.measured?.height || 136);
      const centerY = anchor.y + selectedHeight / 2;
      placeColumn(left, anchor.x - columnOffset, centerY, nodeById);
      placeColumn(right, anchor.x + columnOffset, centerY, nodeById);
    }

    return {
      nodes: nodes.map((node) => {
        const entityId = node.type === "entity" ? node.id : null;
        const workId = node.type === "work" ? node.id.slice(5) : null;
        const work = workId ? snapshot.work.find((item) => item.id === workId) : null;
        const workVisible = work?.targets?.some((id) => visible.has(id));
        const focusPosition = entityId ? focusPositions.get(entityId) : null;
        return {
          ...node,
          ...(focusPosition ? {
            parentId: undefined,
            extent: undefined,
            position: focusPosition,
            draggable: false,
            zIndex: 8,
          } : { draggable: !hasFocus && layoutUnlocked }),
          data: {
            ...node.data,
            focused: entityId === selectedId,
            activeWork: entityId ? activeIds.has(entityId) : false,
            layer: informationLayer,
            showAreaContext: Boolean(hasFocus && entityId && visible.has(entityId)),
            focusedRelationIds: hasFocus ? focusedRelationIds : null,
            dimmed: hasFocus && (entityId ? !visible.has(entityId) : workId ? !workVisible : node.type === "area"),
          },
        };
      }),
      edges: edges.map((edge) => {
        const focused = focusedRelations.has(edge.id);
        return {
          ...edge,
          label: edge.data?.relation ? relationText(edge.data.relation, informationLayer) : edge.label,
          className: [edge.className, focused ? "edge-is-focused" : hasFocus ? "edge-is-dimmed" : ""].filter(Boolean).join(" "),
          data: {
            ...edge.data,
            focused,
            dimmed: hasFocus && !focused,
            onRename: edge.data?.relation && informationLayer === "logic"
              ? () => setRename({ kind: "relation", id: edge.data.relation.id, value: relationText(edge.data.relation, "logic") })
              : undefined,
            onOpen: edge.type === "areaLink" && edge.data?.relations?.length
              ? () => {
                setSelectedWorkId(null);
                setSelectedId(null);
                setSelectedBridge({
                  id: edge.id,
                  relations: edge.data.relations,
                  sourceArea: edge.data.sourceArea,
                  targetArea: edge.data.targetArea,
                });
              }
              : undefined,
          },
        };
      }),
    };
  }, [snapshot, nodes, edges, selectedId, selectedBridge, direction, layoutUnlocked, informationLayer]);

  const onNodeClick = useCallback((_, node) => {
    if (node.type === "entity") { setSelectedId(node.id); setSelectedWorkId(null); setSelectedBridge(null); }
    if (node.type === "work") { setSelectedWorkId(node.id.slice(5)); setSelectedId(null); setSelectedBridge(null); }
  }, []);

  const focusEntity = useCallback((id) => {
    setSelectedId(id);
    setSelectedWorkId(null);
    setSelectedBridge(null);
  }, []);

  useEffect(() => {
    if ((!selectedId && !selectedBridge) || !snapshot) return;
    const timer = window.setTimeout(() => {
      const visible = selectedBridge
        ? new Set(selectedBridge.relations.flatMap((relation) => [relation.from, relation.to]))
        : neighborSet(snapshot, selectedId, direction);
      const focusNodes = getNodes().filter((node) => node.type === "entity" && visible.has(node.id));
      if (focusNodes.length) fitView({ nodes: focusNodes, padding: .14, maxZoom: .82, duration: 500 });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [selectedId, selectedBridge, direction, informationLayer, snapshot, getNodes, fitView]);

  useEffect(() => {
    const focused = Boolean(selectedId || selectedBridge);
    const previous = previousSelectedRef.current;
    previousSelectedRef.current = focused;
    if (!previous || focused) return;
    const timer = window.setTimeout(() => fitView({ padding: .12, duration: 500 }), 280);
    return () => window.clearTimeout(timer);
  }, [selectedId, selectedBridge, fitView]);

  const onNodeDoubleClick = useCallback((_, node) => {
    if (!snapshotRef.current) return;
    if (node.type === "entity") {
      setSelectedId(node.id);
      setSelectedBridge(null);
      const area = node.parentId ? getNodes().find((item) => item.id === node.parentId) : null;
      const x = (area?.position.x || 0) + node.position.x + (node.measured?.width || 264) / 2;
      const y = (area?.position.y || 0) + node.position.y + (node.measured?.height || 140) / 2;
      setCenter(x, y, { zoom: 1, duration: 500 });
    }
    if (node.type === "work") openWork(node.id.slice(5));
  }, [getNodes, setCenter]);

  const saveNodePosition = useCallback(async (_, node) => {
    if (!layoutUnlocked || !snapshotRef.current || node.type === "work") return;
    busyRef.current = true;
    try {
      const current = getNodes();
      const items = [];
      if (node.type === "area") {
        items.push({ kind: "area", id: node.id.slice(5), x: node.position.x, y: node.position.y });
        for (const child of current.filter((item) => item.parentId === node.id && item.type === "entity")) {
          items.push({ kind: "entity", id: child.id, x: node.position.x + child.position.x, y: node.position.y + child.position.y });
        }
      } else {
        const parent = current.find((item) => item.id === node.parentId);
        items.push({ kind: "entity", id: node.id, x: (parent?.position.x || 0) + node.position.x, y: (parent?.position.y || 0) + node.position.y });
      }
      await canvasApi.saveLayout(snapshotRef.current.revision, items, LAYOUT_VERSION);
      notify(node.type === "area" ? "Область перемещена" : "Позиция сохранена");
      await refresh(true);
    } catch (error) { notify(error.message, true); await refresh(true); }
    finally { busyRef.current = false; }
  }, [layoutUnlocked, getNodes, notify, refresh]);

  async function openWork(workId) {
    if (!snapshotRef.current) return;
    try {
      const result = await canvasApi.openWork(snapshotRef.current.revision, workId);
      if (result.outcome === "resume") {
        await navigator.clipboard.writeText(result.command).catch(() => {});
        notify(`Resume-команда скопирована: ${result.command}`);
      } else notify(`Открываю ${result.title || "рабочую сессию"}`);
    } catch (error) { notify(error.message, true); }
  }

  async function saveRename(event) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("value")?.trim();
    if (!value || !rename || !snapshotRef.current) return;
    busyRef.current = true;
    try {
      await canvasApi.rename(snapshotRef.current.revision, rename.kind, rename.id, value);
      setRename(null); notify("Название сохранено"); await refresh(true);
    } catch (error) { notify(error.message, true); }
    finally { busyRef.current = false; }
  }

  async function regenerate() {
    if (!window.confirm("Повторно прочитать репозиторий и обновить смысловую карту?")) return;
    try {
      const status = await canvasApi.regenerate();
      setRegenerating(true); notify(status.started ? "Architect перестраивает карту" : "Перестройка уже идёт");
    } catch (error) { notify(error.message, true); }
  }

  useEffect(() => {
    if (!regenerating) return;
    const timer = window.setInterval(async () => {
      try {
        const status = await canvasApi.architectStatus();
        if (!status.running && status.status !== "running") {
          setRegenerating(false); window.clearInterval(timer);
          notify(status.status === "done" ? "Карта обновлена" : `Architect: ${status.error || "ошибка"}`, status.status !== "done");
          refresh(true);
        }
      } catch {}
    }, 1200);
    return () => window.clearInterval(timer);
  }, [regenerating, notify, refresh]);

  useEffect(() => { canvasApi.updateStatus(true).then(setUpdate).catch(() => {}); }, []);

  const groupedAreas = useMemo(() => (snapshot?.areas || []).map((area) => ({
    area,
    entities: snapshot.entities.filter((entity) => entity.areaId === area.id),
  })), [snapshot]);

  if (!snapshot) return <div className="loading-screen"><span className="brand-mark"><i /><i /><i /></span><strong>Repo Canvas</strong><small>{online ? "строим пространство проекта…" : "нет связи с локальным Canvas"}</small></div>;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><i /><i /><i /></span><span><strong>Repo Canvas</strong><small>память проекта</small></span></div>
        <div className="telemetry"><span><small>ОБЛАСТИ</small><strong>{snapshot.areas.length}</strong></span><span><small>СУЩНОСТИ</small><strong>{snapshot.entities.length}</strong></span><span className="hot"><small>В РАБОТЕ</small><strong>{snapshot.summary.activeWork || 0}</strong></span><span className={`connection ${online ? "is-online" : "is-offline"}`}><i />{online ? "онлайн" : "нет связи"}</span></div>
      </header>

      <main className={`workspace ${selectedId || selectedBridge ? "is-focus-mode" : ""} ${layoutUnlocked ? "is-layout-unlocked" : ""}`}>
        <aside className="navigation-rail">
          <header><span><small>ПРОЕКТ</small><strong>{snapshot.entities.length}</strong></span><button type="button" onClick={() => fitView({ padding: .12, duration: 450 })}>Вся система</button></header>
          <div className="project-tree">
            {groupedAreas.map(({ area, entities }) => <details key={area.id} open>
              <summary onDoubleClick={() => setRename({ kind: "area", id: area.id, value: areaTitle(area) })}><span><strong>{areaTitle(area)}</strong><small>{entities.length} сущностей</small></span></summary>
              {entities.map((entity) => <button key={entity.id} className={selectedId === entity.id ? "is-active" : ""} type="button" onClick={() => focusEntity(entity.id)}><i className={`status-${entity.status}`} />{entityLabel(entity)}</button>)}
            </details>)}
          </div>
        </aside>

        <section className="canvas-panel">
          <header className="canvas-toolbar">
            <span><small>АРХИТЕКТУРА И ТЕКУЩАЯ РАБОТА</small><h1>{selectedEntity ? entityLabel(selectedEntity) : selectedBridge ? `${areaTitle(selectedBridge.sourceArea)} ↔ ${areaTitle(selectedBridge.targetArea)}` : "Весь проект"}</h1></span>
            <nav>
              <div className="layer-switch" aria-label="Слой информации">
                <button type="button" className={informationLayer === "logic" ? "is-active" : ""} onClick={() => setInformationLayer("logic")}>Смысл</button>
                <button type="button" className={informationLayer === "technical" ? "is-active" : ""} onClick={() => setInformationLayer("technical")}>Техника</button>
              </div>
              <button type="button" title="Обновить данные" onClick={() => refresh(true)}><Icon>↻</Icon></button>
              <button type="button" className="regenerate" disabled={regenerating} onClick={regenerate}>{regenerating ? "Карта перестраивается…" : "Повторная генерация"}</button>
              <button
                type="button"
                className={`layout-lock ${layoutUnlocked ? "is-unlocked" : ""}`}
                aria-pressed={layoutUnlocked}
                title={layoutUnlocked ? "Заблокировать позиции" : "Разрешить перемещение нод и областей"}
                onClick={() => {
                  const next = !layoutUnlocked;
                  setLayoutUnlocked(next);
                  notify(next ? "Перемещение включено" : "Позиции заблокированы");
                }}
              >{layoutUnlocked ? "Открыто · 🔓" : "Позиции · 🔒"}</button>
              <button type="button" onClick={() => zoomOut()} aria-label="Уменьшить">−</button>
              <button type="button" onClick={() => fitView({ padding: .12, duration: 450 })}>Показать всё</button>
              <button type="button" onClick={() => zoomIn()} aria-label="Увеличить">+</button>
            </nav>
          </header>
          <div className="canvas-wrap">
            {selectedId ? <div className="focus-toolbar"><span>Фокус</span>{[["in", "Входящие"], ["all", "Все"], ["out", "Исходящие"]].map(([value, label]) => <button key={value} className={direction === value ? "is-active" : ""} onClick={() => setDirection(value)}>{label}</button>)}<button onClick={() => setSelectedId(null)}>Сбросить ×</button></div> : selectedBridge ? <div className="focus-toolbar bridge-toolbar"><span>Мост</span><b>{selectedBridge.relations.length} точных связей</b><button onClick={() => setSelectedBridge(null)}>Сбросить ×</button></div> : null}
            <ReactFlow
              nodes={displayGraph.nodes}
              edges={displayGraph.edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onNodeDragStop={layoutUnlocked ? saveNodePosition : undefined}
              onPaneClick={() => { setSelectedId(null); setSelectedWorkId(null); setSelectedBridge(null); }}
              minZoom={.035}
              maxZoom={1.45}
              selectionOnDrag
              panOnDrag
              elevateNodesOnSelect
              nodesConnectable={false}
              nodesDraggable={layoutUnlocked && !selectedId && !selectedBridge}
              proOptions={{ hideAttribution: true }}
              fitView
            >
              <Background gap={28} size={1} color="#b9ada3" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeStrokeWidth={2} maskColor="rgba(190, 180, 170, .58)" />
            </ReactFlow>
          </div>
        </section>

        <aside className={`inspector ${selectedEntity || selectedWork || selectedBridge ? "is-open" : ""}`}>
          {selectedEntity ? <>
            <header><span><small>{areaTitle(selectedArea)}</small><strong>{entityLabel(selectedEntity)}</strong></span><button onClick={() => setSelectedId(null)}>×</button></header>
            <div className="inspector-status"><span className={`status-${selectedEntity.status}`}>{selectedEntity.status}</span>{currentWork.length ? <span className="live">в работе</span> : null}</div>
            {informationLayer === "logic" ? <>
              <section className="inspector-narrative problem"><h3>Проблема</h3><p>{selectedEntity.problem || "Проблема пока не сформулирована."}</p></section>
              <section className="inspector-narrative solution"><h3>Решение</h3><p>{selectedEntity.solution || selectedEntity.purpose || "Решение пока не сформулировано."}</p></section>
            </> : <>
              <p className="inspector-purpose">{selectedEntity.mechanism || selectedEntity.note || selectedEntity.purpose || "Технический механизм пока не описан."}</p>
              {selectedEntity.invariants?.length ? <section><h3>Гарантии</h3><ul className="invariant-list">{selectedEntity.invariants.map((invariant) => <li key={invariant}>{invariant}</li>)}</ul></section> : null}
              <section><h3>Техническая граница</h3><dl><div><dt>Принимает</dt><dd>{selectedEntity.inputs?.join(", ") || "—"}</dd></div><div><dt>Возвращает</dt><dd>{selectedEntity.outputs?.join(", ") || "—"}</dd></div><div><dt>Код</dt><dd>{selectedEntity.path || "—"}</dd></div></dl></section>
            </>}
            <section><h3>Связи <b>{incoming.length + outgoing.length}</b></h3>{incoming.map((relation) => <button key={relation.id} onClick={() => focusEntity(relation.from)}><i>←</i><span><small>{relationText(relation, informationLayer)}</small><strong>{entityLabel(snapshot.entities.find((item) => item.id === relation.from))}</strong></span></button>)}{outgoing.map((relation) => <button key={relation.id} onClick={() => focusEntity(relation.to)}><i>→</i><span><small>{relationText(relation, informationLayer)}</small><strong>{entityLabel(snapshot.entities.find((item) => item.id === relation.to))}</strong></span></button>)}</section>
            {currentWork.length ? <section><h3>Сейчас</h3>{currentWork.map((work) => <button key={work.id} onClick={() => { setSelectedWorkId(work.id); setSelectedId(null); setSelectedBridge(null); }} onDoubleClick={() => openWork(work.id)}><i className="work-dot" /><span><small>{work.actor}</small><strong>{work.title}</strong></span></button>)}</section> : null}
            <footer><button onClick={() => setRename({ kind: "entity", id: selectedEntity.id, value: entityLabel(selectedEntity) })}>Переименовать</button><small>F2</small></footer>
          </> : selectedWork ? <>
            <header><span><small>{selectedWork.actor || "agent"}</small><strong>{selectedWork.title}</strong></span><button onClick={() => setSelectedWorkId(null)}>×</button></header>
            <p className="inspector-purpose">{selectedWork.note || "Рабочая сессия агента"}</p>
            <div className="inspector-status"><span className="live">{selectedWork.status}</span></div>
            <section><h3>Затрагивает</h3>{selectedWork.targets?.map((id) => <button key={id} onClick={() => { setSelectedId(id); setSelectedWorkId(null); setSelectedBridge(null); }}><i>→</i><strong>{entityLabel(snapshot.entities.find((item) => item.id === id))}</strong></button>)}</section>
            <footer><button disabled={!selectedWork.session} onClick={() => openWork(selectedWork.id)}>Открыть сессию ↗</button></footer>
          </> : selectedBridge ? <>
            <header><span><small>МЕЖДУ ОБЛАСТЯМИ</small><strong>{areaTitle(selectedBridge.sourceArea)} ↔ {areaTitle(selectedBridge.targetArea)}</strong></span><button onClick={() => setSelectedBridge(null)}>×</button></header>
            <p className="inspector-purpose">Агрегированный мост убирает длинные рёбра из общего обзора. Здесь раскрыты все его точные связи.</p>
            <div className="inspector-status"><span>{selectedBridge.relations.length} связей</span></div>
            <section><h3>Точные связи <b>{selectedBridge.relations.length}</b></h3>{selectedBridge.relations.map((relation) => {
              const from = snapshot.entities.find((entity) => entity.id === relation.from);
              const to = snapshot.entities.find((entity) => entity.id === relation.to);
              return <button key={relation.id} onClick={() => focusEntity(relation.from)}><i>↗</i><span><small>{relationText(relation, informationLayer)}</small><strong>{entityLabel(from)} → {entityLabel(to)}</strong></span></button>;
            })}</section>
            <footer><button onClick={() => setSelectedBridge(null)}>Вернуться к обзору</button></footer>
          </> : <div className="inspector-empty"><span>◎</span><strong>Выберите ноду</strong><p>Здесь появятся назначение, связи и текущая работа.</p></div>}
        </aside>
      </main>

      <div className="activity-strip"><span><i className={online ? "online" : ""} />{relativeTime(snapshot.updatedAt)}</span><p>{snapshot.activity?.[0]?.message || "Карта готова"}</p>{update?.status === "available" ? <button onClick={() => canvasApi.applyUpdate()}>Update v{update.availableVersion}</button> : null}</div>
      {message ? <div className={`toast ${message.error ? "is-error" : ""}`}>{message.text}</div> : null}
      {rename ? <div className="modal-backdrop" onMouseDown={() => setRename(null)}><form className="rename-modal" onSubmit={saveRename} onMouseDown={(event) => event.stopPropagation()}><small>РУЧНОЕ ИМЯ</small><h2>Переименовать</h2><input name="value" defaultValue={rename.value} autoFocus maxLength={240} required /><div><button type="button" onClick={() => setRename(null)}>Отмена</button><button type="submit" className="primary">Сохранить</button></div></form></div> : null}
    </div>
  );
}
