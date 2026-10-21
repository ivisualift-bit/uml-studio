import { memo } from 'react';
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import type { GraphNodeRender } from '@/diagrams/render/graphLayout';
import { PrimitiveSvg } from '@/diagrams/shared/PrimitiveSvg';
import { useT } from '@/i18n';
import { useGraphCanvas } from './canvasContext';

export type UmlNodeData = {
  render: GraphNodeRender;
  connectState: 'valid' | 'invalid' | 'source' | null;
};

export type UmlNodeType = Node<UmlNodeData, 'uml'>;

const FIXED_ASPECT = new Set(['initial', 'activityFinal', 'flowFinal', 'junction', 'shallowHistory', 'deepHistory', 'entryPoint', 'exitPoint']);

function UmlNodeImpl({ id, data, selected }: NodeProps<UmlNodeType>) {
  const ctx = useGraphCanvas();
  const t = useT();
  const { render, connectState } = data;
  const { layout } = render;
  const el = render.element;
  const subKind = el?.kind === 'controlNode' ? el.nodeKind : el?.kind === 'pseudostate' ? el.pseudoKind : undefined;
  const outline = layout.outlineBox;
  const showAdd = selected && ctx.singleSelection && ctx.interactive && el && (el.kind === 'class' || el.kind === 'interface' || el.kind === 'enumeration' || el.kind === 'dataType' || el.kind === 'signal');
  const ring = connectState === 'valid' ? 'var(--success)' : connectState === 'invalid' ? 'var(--danger)' : connectState === 'source' ? 'var(--accent)' : null;

  return (
    <div
      className="relative"
      style={{ width: layout.width, height: layout.height }}
      data-testid="uml-node"
      data-view-id={id}
      data-element-id={el?.id ?? ''}
      data-kind={el?.kind ?? 'note'}
      data-name={el?.name ?? ''}
      data-selected={selected ? 'true' : 'false'}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
      <svg width={layout.width} height={layout.height} className="absolute top-0 left-0 overflow-visible" role="img" aria-label={el ? `${t(`elementKind.${el.kind}`)} ${el.name}` : t('elementKind.note')}>
        <PrimitiveSvg primitives={layout.primitives} />
        {selected && (
          <rect
            x={outline.x - 3}
            y={outline.y - 3}
            width={outline.width + 6}
            height={outline.height + 6}
            rx={4}
            fill="none"
            stroke="var(--selection)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}
        {ring && (
          <rect x={outline.x - 4} y={outline.y - 4} width={outline.width + 8} height={outline.height + 8} rx={5} fill="none" stroke={ring} strokeWidth={2.5} pointerEvents="none" />
        )}
      </svg>
      {ctx.interactive && (
        <NodeResizer
          isVisible={!!selected && ctx.singleSelection}
          minWidth={layout.minWidth}
          minHeight={layout.minHeight}
          keepAspectRatio={subKind ? FIXED_ASPECT.has(subKind) : el?.kind === 'finalState'}
          onResize={(_, p) => ctx.setTransientBox(id, { x: p.x, y: p.y, width: p.width, height: p.height })}
          onResizeEnd={(_, p) => ctx.commitBox(id, { x: p.x, y: p.y, width: p.width, height: p.height })}
        />
      )}
      {showAdd && el && (
        <div className="nodrag nopan absolute -bottom-7 left-1/2 flex -translate-x-1/2 gap-1">
          {el.kind === 'enumeration' && (
            <AddButton label={t('canvas.addLiteral')} onClick={() => ctx.addMember(el.id, 'literals')} testId="add-literal" />
          )}
          <AddButton label={t('canvas.addAttribute')} onClick={() => ctx.addMember(el.id, 'attributes')} testId="add-attribute" text="attr" />
          <AddButton label={t('canvas.addOperation')} onClick={() => ctx.addMember(el.id, 'operations')} testId="add-operation" text="op()" />
        </div>
      )}
    </div>
  );
}

function AddButton({ label, onClick, testId, text }: { label: string; onClick: () => void; testId: string; text?: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid={testId}
      className="flex h-5 items-center gap-0.5 rounded border border-border-strong bg-surface-2 px-1.5 text-[10.5px] text-muted shadow-sm hover:border-accent hover:text-accent"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Plus size={11} />
      {text}
    </button>
  );
}

export const UmlNode = memo(UmlNodeImpl);
