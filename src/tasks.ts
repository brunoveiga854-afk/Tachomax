// GPS tracking removed
import * as TaskManager from 'expo-task-manager'

export const LOCATION_TASK_NAME = 'background-location-task'

TaskManager.defineTask(LOCATION_TASK_NAME, async () => {})
