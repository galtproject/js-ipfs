const GossipSub = require('libp2p-gossipsub');
const FloodSub = require('libp2p-floodsub');
const pMap = require('p-map')

const { utils } = require('libp2p-pubsub');
const ensureArray = utils.ensureArray;
// const utils = require('libp2p-pubsub/src/utils')
const { signMessage } = require('libp2p-pubsub/src/message/sign');

const constants = require('libp2p-gossipsub/src/constants')

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

  _publish (messages) {
    messages.forEach((msgObj) => {
      this.messageCache.put(msgObj)
      // @type Set<string>
      const tosend = new Set()
      msgObj.topicIDs.forEach((topic) => {
        const peersInTopic = this.topics.get(topic)
        if (!peersInTopic) {
          return
        }

        // floodsub peers
        peersInTopic.forEach((peer) => {
          if (peer.info.protocols.has(constants.FloodSubID)) {
            tosend.add(peer)
          }
        })

        // Gossipsub peers handling
        let meshPeers = this.mesh.get(topic)
        if (!meshPeers) {
          // We are not in the mesh for topic, use fanout peers
          meshPeers = this.fanout.get(topic)
          if (!meshPeers) {
            // If we are not in the fanout, then pick any peers in topic
            const peers = this._getPeers(topic, constants.GossipSubD)

            if (peers.size > 0) {
              meshPeers = peers
              this.fanout.set(topic, peers)
            } else {
              meshPeers = []
            }
          }
          // Store the latest publishing time
          this.lastpub.set(topic, this._now())
        }

        meshPeers.forEach((peer) => {
          tosend.add(peer)
        })
      })
      // Publish messages to peers
      tosend.forEach((peer) => {
        // if (peer.info.id.toB58String() === msgObj.from) {
        //   return
        // }
        this._sendRpc(peer, { msgs: [msgObj] })
      })
    })
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

module.exports = {
  GossipSub: ImprovedGossibSub,
  FloodSub: ImprovedFloodSub
};
