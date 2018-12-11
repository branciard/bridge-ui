import { action } from "mobx";
import { estimateGas } from './utils/web3'
import { addPendingTransaction } from './utils/testUtils'

class TxStore {
  constructor(rootStore) {
    this.web3Store = rootStore.web3Store
    this.gasPriceStore = rootStore.gasPriceStore
    this.alertStore = rootStore.alertStore
    this.foreignStore = rootStore.foreignStore
    this.homeStore = rootStore.homeStore
  }

  @action
  async doSend({to, from, value, data}){
    return this.web3Store.getWeb3Promise.then(async ()=> {
      if(!this.web3Store.defaultAccount){
        this.alertStore.pushError("Please unlock wallet")
        return
      }
      try {
        const gasPrice = this.gasPriceStore.gasPriceInHex
        const gas = await estimateGas(this.web3Store.injectedWeb3, to, gasPrice, from, value, data)
        return this.web3Store.injectedWeb3.eth.sendTransaction({
          to,
          gasPrice,
          gas,
          from,
          value,
          data
        }).on('transactionHash', (hash) => {
          console.log('txHash', hash)
          this.alertStore.setLoadingStepIndex(1)
          addPendingTransaction()
          this.getTxReceipt(hash)
        }).on('error', (e) => {
          if(!e.message.includes('not mined within 50 blocks') && !e.message.includes('Failed to subscribe to new newBlockHeaders')){
            this.alertStore.setLoading(false)
            this.alertStore.pushError('Transaction rejected on wallet');
          }
        })
      } catch(e) {
        this.alertStore.pushError(e.message);
      }
    })
  }

  @action
  async erc677transferAndCall({to, from, value, contract, tokenAddress }){
    try {
      return this.web3Store.getWeb3Promise.then(async () => {
        if(this.web3Store.defaultAccount.address){
          const data = await contract.methods.transferAndCall(
            to, value, '0x00'
          ).encodeABI()
          return this.doSend({to: tokenAddress, from, value: '0x00', data})
        } else {
          this.alertStore.pushError('Please unlock wallet');
        }
      })
    } catch(e) {
      this.alertStore.pushError(e);
    }
  }

  @action
  async erc20transfer({to, from, value}){
    try {
      return this.web3Store.getWeb3Promise.then(async () => {
        if(this.web3Store.defaultAccount.address){
          const data = await this.foreignStore.tokenContract.methods.transfer(
            to, value
          ).encodeABI({ from: this.web3Store.defaultAccount.address })
          return this.doSend({to: this.foreignStore.tokenAddress, from, value: '0x', data})
        } else {
          this.alertStore.pushError('Please unlock wallet');
        }
      })
    } catch(e) {
      this.alertStore.pushError(e);
    }
  }

  async getTxReceipt(hash){
    const web3 = this.web3Store.injectedWeb3;
    web3.eth.getTransaction(hash, (error, res) => {
      if(res && res.blockNumber){
        this.getTxStatus(hash)
      } else {
        console.log('not mined yet', hash)
        setTimeout(() => {
          this.getTxReceipt(hash)
        }, 5000)
      }
    })
  }

  async getTxStatus(hash) {
    const web3 = this.web3Store.injectedWeb3;
    const { toBN } = web3.utils
    web3.eth.getTransactionReceipt(hash, (error, res) => {
      if(res && res.blockNumber){
        if(res.status === true || toBN(res.status).eq(toBN(1))){
          if(this.web3Store.metamaskNet.id === this.web3Store.homeNet.id.toString()) {
            const blockConfirmations = this.homeStore.latestBlockNumber - res.blockNumber
            if(blockConfirmations >= 8) {
              this.alertStore.setBlockConfirmations(8)
              this.alertStore.setLoadingStepIndex(2)
              this.foreignStore.addWaitingForConfirmation(hash)
            } else {
              if(blockConfirmations > 0) {
                this.alertStore.setBlockConfirmations(blockConfirmations)
              }
              this.getTxStatus(hash)
            }

          } else {
            const blockConfirmations = this.foreignStore.latestBlockNumber - res.blockNumber
            if(blockConfirmations >= 8) {
              this.alertStore.setBlockConfirmations(8)
              this.alertStore.setLoadingStepIndex(2)
              this.homeStore.addWaitingForConfirmation(hash)
            } else {
              if(blockConfirmations > 0) {
                this.alertStore.setBlockConfirmations(blockConfirmations)
              }
              this.getTxStatus(hash)
            }
          }
        } else {
          this.alertStore.setLoading(false)
          this.alertStore.pushError(`${hash} Mined but with errors. Perhaps out of gas`)
        }
      } else {
        this.getTxStatus(hash)
      }
    })
  }

}

export default TxStore;
