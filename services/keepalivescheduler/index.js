const { vcr, Scheduler } = require('@vonage/vcr-sdk')
const CRONJOB_DEFINITION = '* * * * *'

const deleteKeepAlive = async () => {
  try {
    const session = vcr.createSession()
    const scheduler = new Scheduler(session)
    const resp = await scheduler.cancel('keepalive')
    return resp
  } catch (e) {
    console.log(`${e}. Something wrong deleting the keep alive scheduler`)
  }
}

const createKeepAlive = async () => {
  try {
    console.log('creating keep alive scheduler')
    const session = vcr.createSession()
    const scheduler = new Scheduler(session)
    let startAtDate = new Date()
    let endAtDate = new Date()
    endAtDate.setDate(endAtDate.getHours() + 1) // runs for max 1 hour
    await scheduler
      .startAt({
        id: 'keepalive',
        startAt: startAtDate.toISOString(),
        callback: '/keepalive',
        interval: {
          cron: CRONJOB_DEFINITION,
        },
      })
    return
  } catch (e) {
    console.log(`${e}. Something wrong creating the keep alive scheduler`)
  }
}

module.exports = {
  createKeepAlive,
  deleteKeepAlive,
}
