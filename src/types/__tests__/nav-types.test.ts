import { describe, it, expect } from 'vitest';

describe('NavNode', () => {
  it('creates a valid node', () => {
    const node: import('../nav-types').NavNode = {
      id: 'n1',
      label: 'Main Gate',
      position: { lat: 11.82, lng: 122.09 },
      floor: 0,
      buildingId: 'outdoor',
      campusId: 'asu-ibajay',
      type: 'entrance',
    };
    expect(node.id).toBe('n1');
  });
});
