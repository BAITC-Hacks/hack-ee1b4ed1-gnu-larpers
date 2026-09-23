export function groupColor(clusterId: number): string {
  const index = Math.max(0, Math.trunc(clusterId));
  const hue = (index * 137.508 + 265) % 360;
  const saturation = (62 + (index % 3) * 7) / 100;
  const lightness = (65 + (Math.floor(index / 3) % 3) * 5) / 100;
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const phase = (offset + hue / 30) % 12;
    const value = lightness - amplitude * Math.max(-1, Math.min(phase - 3, 9 - phase, 1));
    return Math.round(255 * value).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
