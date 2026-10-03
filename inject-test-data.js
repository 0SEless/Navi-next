const MAP_ID = 'map-test-001';

// Inject campus maps into localStorage
const mapsData = {
  maps: [{
    id: MAP_ID,
    name: 'Test Campus',
    schoolName: 'Test University',
    campusName: 'Main Campus',
    center: { lat: 11.8195, lng: 122.0922 },
    boundary: [
      { lat: 11.8185, lng: 122.0912 },
      { lat: 11.8205, lng: 122.0912 },
      { lat: 11.8205, lng: 122.0932 },
      { lat: 11.8185, lng: 122.0932 },
    ],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    stats: { buildings: 1, nodes: 0, edges: 0 },
  }],
  landmarkTypes: [],
  landmarkInstances: [],
};
localStorage.setItem('navi-campus-maps', JSON.stringify(mapsData));

// Inject graph data
const graphData = {
  buildings: [{
    id: 'bldg-test-001',
    name: 'Test Building',
    campusId: MAP_ID,
    floors: [0],
    footprint: [
      { lat: 11.8192, lng: 122.0918 },
      { lat: 11.8195, lng: 122.0918 },
      { lat: 11.8195, lng: 122.0922 },
      { lat: 11.8192, lng: 122.0922 },
    ],
    baseElevation: 0,
    height: 15,
    color: '#1C6BEB',
    center: { lat: 11.81935, lng: 122.092 },
  }],
  roads: [],
  components: [],
};
localStorage.setItem('navi-graph-' + MAP_ID, JSON.stringify(graphData));
localStorage.setItem('navi-graph', JSON.stringify(graphData));
localStorage.setItem('navi-current-map', MAP_ID);

console.log('Test data injected');
console.log('Map ID:', MAP_ID);
