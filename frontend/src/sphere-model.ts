import type { GraphModel } from './network-model';

interface Member {
  id: string;
  index: number;
  hash: number;
  degree: number;
}

interface Community {
  key: string;
  hash: number;
  members: Member[];
}

interface Region {
  longitudeMin: number;
  longitudeMax: number;
  heightMin: number;
  heightMax: number;
}

export interface SphereLayout {
  positions: Float32Array;
  radius: number;
}

function hashId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export function createSphereLayout(model: GraphModel): SphereLayout {
  const positions = new Float32Array(model.nodes.length * 3);
  if (model.nodes.length === 0) return { positions, radius: 0 };
  const radius = Math.max(36, Math.sqrt(model.nodes.length) * 9);
  if (model.nodes.length === 1) return { positions, radius };
  const members = new Map<string, Member>();
  const communities = new Map<string, Community>();
  for (const [index, node] of model.nodes.entries()) {
    const member = { id: node.id, index, hash: hashId(node.id), degree: 0 };
    members.set(node.id, member);
    const key = `${node.kind}:${node.clusterId}`;
    const community = communities.get(key) ?? { key, hash: hashId(key), members: [] };
    community.members.push(member);
    communities.set(key, community);
  }
  for (const edge of model.edges) {
    const source = members.get(edge.source);
    const target = members.get(edge.target);
    if (!source || !target) continue;
    source.degree += 1;
    target.degree += 1;
  }
  const ordered = [...communities.values()].sort((a, b) => b.members.length - a.members.length || a.hash - b.hash || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const place = (community: Community, region: Region) => {
    const count = community.members.length;
    const longitude = (region.longitudeMin + region.longitudeMax) / 2;
    const height = (region.heightMin + region.heightMax) / 2;
    const centerRadius = Math.sqrt(Math.max(0, 1 - height * height));
    const center = { x: Math.cos(longitude) * centerRadius, y: Math.sin(longitude) * centerRadius, z: height };
    const margin = communities.size > 1 ? Math.min(0.1, 0.45 / Math.sqrt(count)) : 0;
    const phase = community.hash / 4294967296;
    const points = Array.from({ length: count }, (_, index) => {
      const longitudeFraction = count === 1 ? 0.5 : margin + (1 - margin * 2) * ((index * 0.6180339887498949 + phase) % 1);
      const heightFraction = margin + (1 - margin * 2) * (index + 0.5) / count;
      const pointLongitude = region.longitudeMin + (region.longitudeMax - region.longitudeMin) * longitudeFraction;
      const z = region.heightMin + (region.heightMax - region.heightMin) * heightFraction;
      const ringRadius = Math.sqrt(Math.max(0, 1 - z * z));
      const x = Math.cos(pointLongitude) * ringRadius;
      const y = Math.sin(pointLongitude) * ringRadius;
      return { x, y, z, index, distance: x * center.x + y * center.y + z * center.z };
    }).sort((a, b) => b.distance - a.distance || a.index - b.index);
    const sortedMembers = community.members.sort((a, b) => b.degree - a.degree || a.hash - b.hash || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    sortedMembers.forEach((member, index) => {
      const point = points[index];
      positions[member.index * 3] = point.x * radius;
      positions[member.index * 3 + 1] = point.y * radius;
      positions[member.index * 3 + 2] = point.z * radius;
    });
  };
  const partition = (groups: Community[], region: Region) => {
    if (groups.length === 1) { place(groups[0], region); return; }
    const count = groups.reduce((sum, group) => sum + group.members.length, 0);
    let split = 1;
    let leftCount = groups[0].members.length;
    let running = 0;
    let difference = Infinity;
    for (let index = 0; index < groups.length - 1; index += 1) {
      running += groups[index].members.length;
      const nextDifference = Math.abs(count / 2 - running);
      if (nextDifference < difference) { difference = nextDifference; split = index + 1; leftCount = running; }
      if (running >= count / 2) break;
    }
    const middleHeight = (region.heightMin + region.heightMax) / 2;
    const width = (region.longitudeMax - region.longitudeMin) * Math.sqrt(Math.max(0.05, 1 - middleHeight * middleHeight));
    const height = Math.asin(region.heightMax) - Math.asin(region.heightMin);
    if (width >= height) {
      const boundary = region.longitudeMin + (region.longitudeMax - region.longitudeMin) * leftCount / count;
      partition(groups.slice(0, split), { ...region, longitudeMax: boundary });
      partition(groups.slice(split), { ...region, longitudeMin: boundary });
    } else {
      const boundary = region.heightMin + (region.heightMax - region.heightMin) * leftCount / count;
      partition(groups.slice(0, split), { ...region, heightMax: boundary });
      partition(groups.slice(split), { ...region, heightMin: boundary });
    }
  };
  partition(ordered, { longitudeMin: 0, longitudeMax: Math.PI * 2, heightMin: -1, heightMax: 1 });
  return { positions, radius };
}
