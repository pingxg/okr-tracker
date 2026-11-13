export default {
  name: {
    type: 'string',
    required: true,
  },
  missionStatement: {
    type: 'string',
    required: false,
  },
  photoURL: {
    type: 'string',
    required: false,
  },
  secret: {
    type: 'string',
    required: false,
  },
  team: {
    type: 'array',
    required: false,
  },
  // Own information groups: [{ title, fields: [{ label, value }] }]
  details: {
    type: 'array',
    required: false,
  },
};
