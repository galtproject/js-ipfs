'use strict'

const debug = require('debug')
const parseDuration = require('parse-duration').default
const errcode = require('err-code')

const log = debug('ipfs:name:publish')
log.error = debug('ipfs:name:publish:error')

const { OFFLINE_ERROR, normalizePath, withTimeoutOption } = require('../../utils')

/**
 * @typedef { import("../index") } IPFS
 */

/**
 * IPNS - Inter-Planetary Naming System
 *
 * @param {IPFS} self
 * @returns {Object}
 */
module.exports = ({ ipns, isOnline }) => {
  /**
   * IPNS is a PKI namespace, where names are the hashes of public keys, and
   * the private key enables publishing new (signed) values. In both publish
   * and resolve, the default name used is the node's own PeerID,
   * which is the hash of its public key.
   *
   * @param {String} value ipfs path of the object to be published.
   * @param {Object} options ipfs publish options.
   * @param {boolean} options.resolve resolve given path before publishing.
   * @param {String} options.lifetime time duration that the record will be valid for.
  This accepts durations such as "300s", "1.5h" or "2h45m". Valid time units are
  "ns", "ms", "s", "m", "h". Default is 24h.
    * @param {String} options.ttl time duration this record should be cached for (NOT IMPLEMENTED YET).
    * This accepts durations such as "300s", "1.5h" or "2h45m". Valid time units are
    "ns", "ms", "s", "m", "h" (caution: experimental).
    * @param {String} options.key name of the key to be used, as listed by 'ipfs key list -l'.
    * @param {function(Error)} [callback]
    * @returns {Promise|void}
    */
  return withTimeoutOption(async function publish (privateKey, value, options) {
    options = options || {}

    const lifetime = options.lifetime || '24h'

    if (!isOnline()) {
      throw errcode(new Error(OFFLINE_ERROR), 'OFFLINE_ERROR')
    }

    // TODO: params related logic should be in the core implementation

    // Normalize path value
    try {
      value = normalizePath(value)
    } catch (err) {
      log.error(err)
      throw err
    }

    let pubLifetime
    try {
      pubLifetime = parseDuration(lifetime)

      // Calculate lifetime with nanoseconds precision
      pubLifetime = pubLifetime.toFixed(6)
    } catch (err) {
      log.error(err)
      throw err
    }

    // Start publishing process
    return ipns.publish(privateKey, value, pubLifetime)
  })
}
