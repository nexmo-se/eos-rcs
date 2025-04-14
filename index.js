const express = require('express')
const bodyParser = require('body-parser')
const app = express()
const { v4: uuidv4 } = require('uuid')
const cors = require('cors')
const flash = require('express-flash')
const methodOverride = require('method-override')
const passport = require('passport')
const tps = parseInt(process.env.tps || '30', 10)
const cookieSession = require('cookie-session')
const { PassThrough } = require("stream")
const whitelistRouter = require('./router/whitelist')
const { vcr, Assets, Scheduler, State, Messages } = require('@vonage/vcr-sdk')

const csvService = require('./services/csv')
const smsService = require('./services/sms')
const constants = require('./constants')
const keepAlive = require('./services/keepalivescheduler')
const utils = require('./utils')
const initializePassport = require('./passport-strategy')
const { default: axios } = require('axios')
const blackListService = require('./services/blacklist')

const session = vcr.getGlobalSession()
const globalState = new State(session)//, `application:f5897b48-9fab-4297-afb5-504d3b9c3296`)

const VCR_URL = process.env.VCR_INSTANCE_PUBLIC_URL;

const messaging = new Messages(session)

const listenMessages = async () => {
  await messaging.onMessage("inbound", { type: null, number: null }, {
    type: 'rcs',
    number: null,
  })
}
listenMessages()

const CRONJOB_DEFINITION_SCHEDULER = '0 9-20 * * 1-5'
const TEMPLATES_TABLENAME = 'TEMPLATES'

const EOS_CRONJOB = '15,45 6-20 * * 1-6'

// cancel all monitoring schedulers when server crashes or not
const ON_CRASH_CANCEL_MONITOR = false

app.use(cors())
app.use(flash())
app.use(
  cookieSession({
    name: 'session',
    keys: ['secretcat'],
    secure: false,
    resave: false,
    maxAge: 24 * 60 * 60 * 1000,
  })
)
app.use(passport.initialize())
app.use(passport.session())
app.use(methodOverride('_method'))

initializePassport(
  passport,
  async (email) => {
    const customer = await globalState.mapGetValue('users', email)
    if (!customer) return null
    return JSON.parse(customer)
  },
  async (email) => {
    const customer = await globalState.mapGetValue('users', email)
    return customer
  }
)

app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())
app.set('view engine', 'ejs')
app.use('/whitelist', whitelistRouter())

app.get('/_/health', async (req, res) => {
  res.sendStatus(200)
})

//this is to keep alive the vcr app while writting files to avoid restarts
app.get('/keepalive', (req, res) => {
  // console.log('keep alive ping');
  res.sendStatus(200)
})

app.get('/login', utils.checkNotAuthenticated, (req, res) => {
  res.render('templates/login', {})
})

app.get('/', utils.checkNotAuthenticated, (req, res) => {
  res.redirect('/login')
})

app.post(
  '/login',
  utils.checkNotAuthenticated,
  passport.authenticate('local', {
    successRedirect: '/templates/new',
    failureRedirect: '/login',
    failureFlash: true,
  })
)

// TEMPLATE VIEWS START
// Get a list of templates as ejs view
app.get('/templates', utils.checkAuthenticated, async (req, res) => {
  const templates = await globalState.mapGetAll(TEMPLATES_TABLENAME)
  const parsedTemplates = Object.keys(templates).map((key) => {
    const data = JSON.parse(templates[key])
    return { ...data }
  })
  res.render('templates/index', { templates: parsedTemplates })
})

// Get a form to create a new template
app.get('/templates/new', utils.checkAuthenticated, async (req, res) => {
  res.render('templates/new', {})
})

// TEMPLATE VIEWS END

// TEMPLATE API START
// Get a list of all templates

app.get('/api/templates', async (req, res) => {
  const templates = await globalState.mapGetAll(TEMPLATES_TABLENAME)
  const parsedTemplates = Object.keys(templates).map((key) => {
    const data = JSON.parse(templates[key])
    return { ...data }
  })
  res.json(parsedTemplates)
})
app.get('/support/:phone', async (req, res) => {
  const phone = req.params.phone
  const isRcsSupported = await utils.checkRCS(phone)
  console.log(isRcsSupported)
  res.send(isRcsSupported)
})

// Get a single temaplte by id
app.get('/api/templates/:id', async (req, res) => {
  const { id } = req.params
  if (!id) {
    return res.status(404).json({ success: false, error: 'please provide a valid id' })
  }
  const template = await globalState.mapGetValue(TEMPLATES_TABLENAME, id)
  const parsedTemplate = await JSON.parse(template)
  res.json(parsedTemplate)
})

// Create a new template
app.post('/api/templates', async (req, res) => {
  const { id, text, senderIdField, rcsEnabled } = req.body
  let newTemplate
  const updatedAt = new Date().toISOString()
  if (id && text && senderIdField) {
    newTemplate = { id, text, senderIdField, rcsEnabled }
    const created = await globalState.mapSet(TEMPLATES_TABLENAME, {
      [id]: JSON.stringify({ id, text, senderIdField, updatedAt, rcsEnabled }),
    })
    res.json({ created, newTemplate })
  } else if (!id && text && senderIdField) {
    let id = uuid()
    newTemplate = { id, text, senderIdField, rcsEnabled }
    const created = await globalState.mapSet(TEMPLATES_TABLENAME, {
      [id]: JSON.stringify({
        id,
        text,
        senderIdField,
        updatedAt,
        rcsEnabled,
      }),
    })
    res.json({ created, newTemplate })
  } else {
    res.status(500).json({
      success: false,
      error: 'please provide at least a valid text and senderIdField and also an id in case of updating existing templates.',
    })
  }
})

// Delete a template by ID
app.delete('/api/templates/:id', async (req, res) => {
  const { id } = req.params
  if (!id) {
    return res.status(404).json({ success: false, error: 'please provide a valid id' })
  }
  const deleted = await globalState.mapDelete(TEMPLATES_TABLENAME, [id])
  res.json({ success: true, deleted })
})

app.post('/keepalivepinger', async (req, res) => {
  const resp = await keepAlive.deleteKeepAlive()
  res.send(resp)
})

app.post('/inbound', async (req, res) => {
  try {
    if (req.body && req.body.from && req.body.text) {
      const number = req.body.from
      const text = req.body.text
      if (text.toUpperCase() === 'STOP') {
        const response = await blackListService.blacklist(number)
        const resultOptOut = await smsService.sendOptOutRcs(utils.rcsAgent, number)
        console.log(resultOptOut)
      }
      console.log('message received', req.body)

      res.sendStatus(200)
    } else {
      res.sendStatus(500)
    }
  } catch (e) {
    console.log(e)
    res.sendStatus(500)
  }
})

app.get('/checkTime', async (req, res) => {
  try {
    const secondsTillEndOfDay = utils.secondsTillEndOfDay()
    const state = await globalState.get('processingState')
    res.send({ secondsTillEndOfDay, state })
  } catch (e) {
    console.log(e)
  }
})

//End of template APIs

// Scheduler API that is responsible for starting or stopping the vcr scheduler that constantly checks for new csv files in the vcr assets directory that was specified
// The endAtDate and maxInvocations should be removed unless in debug mode, because this scheduler should always be running as a cron job.
// We could use an env var to define the timeframe or cron for when it should run.
app.post('/scheduler', async (req, res) => {
  const { command, maxInvocations } = req.body
  const session = vcr.createSession()
  const scheduler = new Scheduler(session)

  if (command == 'start') {
    let startAtDate = new Date() // default is now
    let endAtDate = new Date()
    endAtDate.setDate(endAtDate.getDate() + 1) // runs for max 1 day
    let until = {}
    let maxInvocationsInt = parseInt(maxInvocations)
    if (maxInvocations && maxInvocationsInt && maxInvocationsInt > 0) {
      until = {
        until: {
          date: endAtDate.toISOString(), // just ot be sure also limit days for demo purpose
          maxInvocations: maxInvocationsInt, // max 1 hour with one invocation per minute
        },
      }
    }
    const schedulerCreated = await scheduler
      .startAt({
        id: 'checkandsender',
        startAt: startAtDate.toISOString(),
        callback: '/checkandsend',
        interval: {
          cron: EOS_CRONJOB,
          // ...until,
        },
      })
    res.json({ schedulerCreated })
  } else if (command == 'stop') {
    // delete scheduler with fix name
    const schedulerDeleted = await scheduler.cancel('checkandsender')
    res.json({ schedulerDeleted })
  }
})

async function processAllFiles(files, assets, scheduler) {
  console.info("Processing all files...")
  console.info("Files: ", files)
  let interval
  let records = []
  for (const filename of files) {
    // toBeProcessed.forEach(async (filename) => {
    // process and send the file
    console.info('processing file' + filename)
    try {
      //console.info("Getting asset: ", filename)
      const asset = await assets.getRemoteFile(filename)
      const chunks = asset.pipe(new PassThrough())
      let rawFileData = ''
      for await (let chunk of chunks) {
        rawFileData += chunk
      }
      records = csvService.fromCsvSync(rawFileData, {
        columns: true,
        delimiter: ';',
        skip_empty_lines: true,
        skip_lines_with_error: true,
        relax_column_count_more: true,
      })
			// console.log("records: ", JSON.stringify(records));
    } catch (e) {
      console.info('There was an error parsing the csv file: ', e.message || e)
      await globalState.set('processingState', false)
      // await keepAlive.deleteKeepAlive();
    }
    console.info("Records finished: ", records && records.length ? records.length : 'no record length found')
    const secondsTillEndOfDay = utils.secondsTillEndOfDay()
    const secondsNeededToSend = parseInt((records.length - 1) / tps)
    //only send if there's enough time till the end of the working day
    if (secondsTillEndOfDay > secondsNeededToSend){// && utils.timeNow() >= 7) {
      try {
        await globalState.set('processingState', true)
        const newCheck = new Date().toISOString()
        const savedNewCheck = await globalState.set('lastCsvCheck', newCheck)
        console.log(`There are ${secondsTillEndOfDay} sec left and I need ${secondsNeededToSend}`)
        const startProcessingDate = new Date().toISOString()
        console.log('file name: ' + filename)
        const sendingResults = await smsService.sendAllMessages(records, filename)
        const endProcessingDate = new Date().toISOString()
        const failedResults = sendingResults.filter((result) => result.type)
        const failedSummary = [
          {
            failed: failedResults.length,
            //I need to consider the last object of the array which contains the sms/rcs breakdown
            successful: sendingResults.length - failedResults.length - 1,
            smsSent: sendingResults.at(-1).smsCount,
            rcsSent: sendingResults.at(-1).rcsCount,
            blackList: sendingResults.at(-1).blackListed,
            startAt: startProcessingDate,
            endAt: endProcessingDate,
          },
        ]
        const failedPath = filename.split('/')[2].replace('.csv', '-failed-output.csv')
        if (failedResults.length > 0) {
          await utils.writeResults(failedResults, failedPath, constants.failedResultsHeader)
          await assets.uploadFiles([failedPath], `output/`)
        }
        const path = filename.split('/')[2].replace('.csv', '-output.csv')
        await utils.writeResults(failedSummary, path, constants.failedHeader)
        // await utils.writeResults(resultsToWrite, path, constants.resultsHeader);
        const result = await assets.uploadFiles([path], `output/`)
        const processedPath = filename.split('/')[2].replace('.csv', '-processed.csv')
        const fileMoved = await utils.moveFile(assets, processedPath, 'processed/', records, filename)
        await globalState.set('processingState', false)
        clearInterval(interval)
        // await keepAlive.deleteKeepAlive();
      } catch (e) {
				console.error("Error sending message ", e.message || e)
        await globalState.set('processingState', false)
        clearInterval(interval)
        // await keepAlive.deleteKeepAlive();
      }
    } else if (secondsTillEndOfDay < 0) {
      console.log('cannot send, end of day')
    } else if (secondsTillEndOfDay > 0 && secondsNeededToSend > secondsTillEndOfDay) {
      try {
        console.log('there is no time to send all the records. Splitting file... ')

        await globalState.set('processingState', true)
        console.log('I have ' + secondsTillEndOfDay + ' to send')
        //10 % security
        const numberOfRecordsToSend = parseInt(tps * secondsTillEndOfDay * 0.9)
        console.log('I can send ' + numberOfRecordsToSend)

        //send the messages until the end of the allowed period
        try {
          interval = setInterval(() => {
            // axios.get(`http://${process.env.INSTANCE_SERVICE_NAME}.neru/keepalive`)
            axios.get(`${VCR_URL}/keepalive`)
          }, 1000)
          // if (schedulers.list.indexOf('keepalive') !== -1) await keepAlive.createKeepAlive();
        } catch (e) {
          console.log('the scheduler already exists')
        }
        const sendingRecords = records.slice(0, numberOfRecordsToSend)
        const startProcessingDate = new Date().toISOString()
        const sendingResults = await smsService.sendAllMessages(sendingRecords, filename)
        const endProcessingDate = new Date().toISOString()
        const failedResults = sendingResults.filter((result) => result.title)
        const failedSummary = [
          {
            failed: failedResults.length,
            successful: sendingResults.length - failedResults.length,
            startAt: startProcessingDate,
            endAt: endProcessingDate,
            smsSent: sendingResults.at(-1).smsCount,
            rcsSent: sendingResults.at(-1).rcsCount,
          },
        ]
        //write the resuls file
        if (failedResults.length > 0) {
          const failedPath = filename.split('/')[2].replace('.csv', '-failed-1-output.csv')
          await utils.writeResults(failedResults, failedPath, constants.failedResultsHeader)
          await assets.uploadFiles([failedPath], `output/`)
        }
        const path = filename.split('/')[2].replace('.csv', '-1-output.csv')
        await utils.writeResults(failedSummary, path, constants.failedHeader)
        await assets.uploadFiles([path], `output/`)

        //move the subfile that has been processed to the processed folder
        const processedPath = filename.split('/')[2].replace('.csv', '-1-processed.csv')
        await utils.moveFile(assets, processedPath, 'processed/', sendingRecords, filename)
        //upload the pending records to be processed next morning
        const newFile = records.slice(numberOfRecordsToSend, records.length)
        const pathToFile = filename.split('/')[2].replace('.csv', '-2.csv')
        await utils.writeResults(newFile, pathToFile, constants.processedFileHeader)
        const result = await assets.uploadFiles([pathToFile], `send/`)
        await globalState.set('processingState', false)
        clearInterval(interval)
        // await keepAlive.deleteKeepAlive();
      } catch (e) {
        console.error("Error sending split file. ", e.message || e)
        await globalState.set('processingState', false)
        // await keepAlive.deleteKeepAlive();
      }
    }
  }
  // save info that file was processed already
  // });
}

app.post('/checkandsend', async (req, res) => {
  console.log('Checking for files and sending if new CSV files exist...')
  const FILETYPES = 'send/'
  const PROCESSEDFILES = 'processedfiles'
  try {
    // create a vcr session
    const session = vcr.createSession()

    const scheduler = new Scheduler(session)
    // init assets access
    const assets = new Assets(session)
    const lastCheck = await globalState.get('lastCsvCheck')
    const processingFiles = await globalState.get('processingState')
    console.log('processing files ? ' + processingFiles)
    // get file list from assets api
    const assetlist = await assets.list(FILETYPES, false, 10)
    console.log(JSON.stringify(assetlist))
    let toBeProcessed = []

    if (!assetlist || !assetlist.res || assetlist.res.length <= 0) {
      console.warn('Found no new csv files in asset list.')
      return res.json({
        success: false,
        error: 'No new files found but no error.',
      })
    }
    assetlist.res.forEach((file) => {
      if (
        file &&
        file.name &&
        file.name.endsWith('.csv') &&
        (!lastCheck || new Date(file.lastModified) > new Date(lastCheck)) &&
        !processingFiles
      ) {
        toBeProcessed.push('/' + file.name)
      } else {
        console.log('I will not send since the file is already processed or there are files being processed')
        // console.log("file: ", JSON.stringify(file));
        // console.log("lastCheck: ", lastCheck);
        // console.log("file.lastModified > lastCheck ? ", new Date(file.lastModified) > new Date(lastCheck))
        // console.log("processingFiles: ", processingFiles);
      }
    })

    processAllFiles(toBeProcessed, assets, scheduler)

    res.sendStatus(200)
  } catch (e) {
    console.error('check and send error: ', e)
    res.sendStatus(500)
  }
})

app.post('/remove-blacklist', async (req, res) => {
  try {
    if (req.body && req.body.number) {
      const number = req.body.number
      const response = await blackListService.removeBlacklist(number)
      console.log(response)
      res.sendStatus(200)
    } else {
      res.sendStatus(500)
    }
  } catch (e) {
    console.log(e)
    res.sendStatus(500)
  }
})

app.listen(process.env.VCR_PORT || 3000, async () => {
  console.log(`listening on port ${process.env.VCR_PORT}!`)
  // if (process.env.VCR_DEBUG == "true") {
    
    const email = 'toni.kuschan@vonage.com'
    await globalState.mapSet('users', {
      [email]: JSON.stringify({
        id: uuidv4(),
        email: email,
        name: 'Toni Test',
        password: '1234',
      }),
    })
      
  // }
  await globalState.set('processingState', false)
})

process.on('beforeExit', (code) => {
  console.log('Process beforeExit event with code: ', code)
})