import type { ViewStyle } from '@/domain/schemas/views';

/** Colours used by the notation layer. The canvas follows the UI theme; exports use `PRINT_THEME`. */
export interface DiagramTheme {
  name: 'print' | 'light' | 'dark';
  background: string;
  nodeFill: string;
  nodeStroke: string;
  text: string;
  mutedText: string;
  edge: string;
  noteFill: string;
  noteStroke: string;
  containerFill: string;
  laneHeaderFill: string;
  fragmentLabelFill: string;
  activationFill: string;
  solidFill: string;
}

export const PRINT_THEME: DiagramTheme = {
  name: 'print',
  background: '#ffffff',
  nodeFill: '#ffffff',
  nodeStroke: '#1f2328',
  text: '#111418',
  mutedText: '#4b5563',
  edge: '#1f2328',
  noteFill: '#fff8d6',
  noteStroke: '#8a7a3a',
  containerFill: '#ffffff',
  laneHeaderFill: '#f1f3f5',
  fragmentLabelFill: '#f1f3f5',
  activationFill: '#e9ecef',
  solidFill: '#1f2328',
};

export const LIGHT_THEME: DiagramTheme = {
  ...PRINT_THEME,
  name: 'light',
  background: '#fbfbfc',
  nodeFill: '#ffffff',
};

export const DARK_THEME: DiagramTheme = {
  name: 'dark',
  background: '#161a20',
  nodeFill: '#1f252e',
  nodeStroke: '#aab4c2',
  text: '#e6e9ee',
  mutedText: '#9aa4b2',
  edge: '#aab4c2',
  noteFill: '#33301f',
  noteStroke: '#9c8f55',
  containerFill: '#1a1f26',
  laneHeaderFill: '#252c36',
  fragmentLabelFill: '#252c36',
  activationFill: '#2c3440',
  solidFill: '#d5dbe3',
};

export interface ResolvedStyle {
  fill: string;
  stroke: string;
  text: string;
  fontSize: number;
  lineWidth: number;
}

export const BASE_FONT_SIZE = 13;

export function resolveStyle(
  theme: DiagramTheme,
  style: ViewStyle | undefined,
  fill = theme.nodeFill,
): ResolvedStyle {
  return {
    fill: style?.fill ?? fill,
    stroke: style?.stroke ?? theme.nodeStroke,
    text: style?.textColor ?? theme.text,
    fontSize: style?.fontSize ?? BASE_FONT_SIZE,
    lineWidth: style?.lineWidth ?? 1.2,
  };
}
