export default {
  value: {
    type: 'number',
    required: true,
  },
  comment: {
    type: 'string',
    required: false,
  },
  timestamp: {
    type: 'date',
    required: false,
  },
  // Status set by hand at this check-in (onTrack | atRisk | behind), and why.
  status: {
    type: 'string',
    required: false,
  },
  statusNote: {
    type: 'string',
    required: false,
  },
};
