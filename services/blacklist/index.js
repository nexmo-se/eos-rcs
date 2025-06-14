const { vcr } = require('@vonage/vcr-sdk')
const DB_TABLENAME_BLACKLIST = 'DB_TABLENAME_BLACKLIST'

const blacklist = async (number) => {
  const db = vcr.getInstanceState()
  const blacklistResponse = await db.mapSet(DB_TABLENAME_BLACKLIST, { [number]: 'true' })
  return blacklistResponse
}

const removeBlacklist = async (number) => {
  const db = vcr.getInstanceState()
  const blacklistResponse = await db.mapDelete(DB_TABLENAME_BLACKLIST, [number])
  return blacklistResponse
}

const isBlackListed = async (number) => {
  try {
    const db = vcr.getInstanceState()
    if (!number) throw new Error('no number provided')

    let isBlackListed = await db.mapGetValue(DB_TABLENAME_BLACKLIST, number.toString())
    return isBlackListed || false
  } catch (e) {
    console.log('blacklist check error:', e.response?.status, e.response?.data?.error, e.message)
  }
}

module.exports = {
  blacklist,
  isBlackListed,
  removeBlacklist
}
