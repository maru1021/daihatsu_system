function initializeToolNoSelect() {
  initializeRelationSelect(
    '/manufacturing/api/machining-tool-nos-by-machine',
    $('.machine-select'),
    $('.tool-no-select'),
    'machine_id',
    'tool_no_id'
  );
}
