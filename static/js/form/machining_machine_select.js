function initializeMachineSelect() {
  initializeRelationSelect(
    '/manufacturing/api/machining-machines-by-line',
    $('.line-select'),
    $('.machine-select'),
    'line_id',
    'machine_id'
  );
}
