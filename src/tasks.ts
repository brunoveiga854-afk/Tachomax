import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'

export const LOCATION_TASK_NAME = 'background-location-task'

TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }: any) => {
  if (error) { console.log('Background GPS error:', error); return }
  if (data) {
    const { locations } = data
    if (locations && locations.length > 0) {
      const loc = locations[0]
      console.log('Background GPS:', loc.coords.latitude, loc.coords.longitude, loc.coords.speed)
    }
  }
})