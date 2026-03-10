export default function getToolbarModule({ servicesManager }) {
  return [
    {
      name: 'FlatfootMeasurement',
      icon: 'tool-angle', // Re-using OHIF's angle tool icon
      label: 'Flatfoot Arch',
      tooltip: 'Measure Flatfoot Longitudinal Arch',
      commandName: 'setToolActive',
      commandOptions: { toolName: 'FlatfootMeasurement' },
    }
  ];
}
