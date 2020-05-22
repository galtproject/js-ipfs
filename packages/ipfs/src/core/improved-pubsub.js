const GossipSub = require('libp2p-gossipsub');
const FloodSub = require('libp2p-floodsub');
const pMap = require('p-map')
const PeerId = require('peer-id')

const { utils } = require('libp2p-pubsub');
const ensureArray = utils.ensureArray;
// const utils = require('libp2p-pubsub/src/utils')
const { signMessage } = require('libp2p-pubsub/src/message/sign');
const { Message } = require('libp2p-pubsub/src/message/index');

const SignPrefix = Buffer.from('libp2p-pubsub:')

class ImprovedGossibSub extends GossipSub {
  async _buildMessage (message) {
    return this._buildMessageByPeerId(this.peerId, message);
  }

  async _buildMessageByPeerId (peerId, message) {
    const msg = utils.normalizeOutRpcMessage(message)
    if (this.peerId) {
      return signMessage(peerId, msg)
    } else {
      return message
    }
  }

  async publishByPeerId (peerId, topics, messages) {
    if (!this.started) {
      throw new Error('Pubsub has not started')
    }

    this.log('publish', topics, messages)

    topics = utils.ensureArray(topics)
    messages = utils.ensureArray(messages).map(d => Buffer.from(d))

    const from = this.peerInfo.id.toB58String()

    const buildMessage = async (msg, cb) => {
      const seqno = utils.randomSeqno()
      const msgObj = {
        from: from,
        data: msg,
        seqno: seqno,
        topicIDs: topics
      }
      // put in seen cache
      this.seenCache.put(msgObj.seqno)

      const res = await this._buildMessageByPeerId(peerId, msgObj);
      // Emit to self if I'm interested and emitSelf enabled
      this._options.emitSelf && this._emitMessages(topics, [{ ...msgObj, key: peerId._pubKey.bytes, signature: res.signature }])
      return res;
    }
    const msgObjects = await pMap(messages, buildMessage)

    // send to all the other peers
    this._publish(utils.normalizeOutRpcMessages(msgObjects))
  }

  async validate (message) { // eslint-disable-line require-await
    // If strict signing is on and we have no signature, abort
    if (this.strictSigning && !message.signature) {
      this.log('Signing required and no signature was present, dropping message:', message)
      return false
    }

    // Check the message signature if present
    if (message.signature) {
      return verifySignature(message)
    } else {
      return true
    }
  }

  async publish(topics, messages) {
    return this.publishByPeerId(this.peerId, topics, messages);
  }
}

class ImprovedFloodSub extends FloodSub {
  _buildMessage (message) {
    return this._buildMessageByPeerId(this.peerId, message);
  }

  _buildMessageByPeerId (peerId, message) {
    const msg = utils.normalizeOutRpcMessage(message)
    if (this.peerId) {
      return signMessage(peerId, msg)
    } else {
      return message
    }
  }

  async publishByPeerId (peerId, topics, messages) {
    if (!this.started) {
      throw new Error('FloodSub is not started')
    }

    log('publish', topics, messages)

    topics = ensureArray(topics)
    messages = ensureArray(messages).map(d => Buffer.from(d))

    const from = this.peerInfo.id.toB58String()

    const buildMessage = async (msg) => {
      const seqno = utils.randomSeqno()
      this.seenCache.put(utils.msgId(from, seqno))

      const message = {
        from: from,
        data: msg,
        seqno: seqno,
        topicIDs: topics
      }

      const res = await this._buildMessageByPeerId(peerId, message);
      // Emit to self if I'm interested and it is enabled
      this._options.emitSelf && this._emitMessages(topics, [{ ...message, key: peerId._pubKey.bytes, signature: res.signature }])
      return res;
    }

    const msgObjects = await pMap(messages, buildMessage)

    // send to all the other peers
    this._forwardMessages(topics, msgObjects)
  }

  async publish(topics, messages) {
    return this.publishByPeerId(this.peerId, topics, messages);
  }
}

async function verifySignature (message) {
  // Get message sans the signature
  const baseMessage = { ...message }
  delete baseMessage.signature
  delete baseMessage.key
  const bytes = Buffer.concat([
    SignPrefix,
    Message.encode(baseMessage)
  ])

  // Get the public key
  const pubKey = await messagePublicKey(message)

  // verify the base message
  return pubKey.verify(bytes, message.signature)
}

async function messagePublicKey (message) {
  if (message.key) {
    const peerId = await PeerId.createFromPubKey(message.key)
    return peerId.pubKey;
    // the key belongs to the sender, return the key
    // if (peerId.isEqual(message.from)) return peerId.pubKey
    // We couldn't validate pubkey is from the originator, error
    // throw new Error('Public Key does not match the originator')
  } else {
    // should be available in the from property of the message (peer id)
    const from = PeerId.createFromBytes(message.from)

    if (from.pubKey) {
      return from.pubKey
    } else {
      throw new Error('Could not get the public key from the originator id')
    }
  }
}

module.exports = {
  GossipSub: ImprovedGossibSub,
  FloodSub: ImprovedFloodSub
};
