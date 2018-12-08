/*
// communicates with the user via HTTP.
// communicates with other nodes through P2P connections.
*/

'use strict';
var CryptoJS = require("crypto-js");
var express = require("express");
var bodyParser = require('body-parser');
var WebSocket = require("ws");

// set environment variable
var http_port = process.env.HTTP_PORT || 3001;                              // > $env:HTTP_PORT=3003
var p2p_port = process.env.P2P_PORT || 6001;                                // > $env:P2P_PORT=6003
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];   // > $env:PEERS = "ws://127.0.0.1:6001, ws://127.0.0.1:6002"

// minimum block structure
class Block {
    constructor(index, previousHash, timestamp, data, hash,difficulty,nonce) {
        this.index = index;
        this.previousHash = previousHash.toString();
        this.timestamp = timestamp;
        this.data = data;
        this.hash = hash.toString();
        this.difficulty = difficulty;
        this.nonce = nonce;
    }
}

// WARNING!! if you modify any of the following data,
// you might need to obtain a new hash(SHA256) value
function getGenesisBlock(){
    //index, previousHash, timestamp, data, hash,difficulty
    
    // 새로 해시값 구하기
    // console.log(calculateHash(0, "", 1535165503, "Genesis block",0,0));
    return new Block(0, "", 1535165503, "Genesis block", "1c9c452672569e58c48b50ea4828ea00e4cc2df8c2431f705856b797b1bcb882",0,0);
};

// WARNING!! the current implementation is stored in local volatile memory.
// you may need a database to store the data permanently.
var blockchain = [getGenesisBlock()];

function getBlockchain(){
    return blockchain;
}

var sockets = [];
var MessageType = {
    QUERY_LATEST: 0,
    QUERY_ALL: 1,
    RESPONSE_BLOCKCHAIN: 2
};

// REST API
function initHttpServer(){
    var app = express();
    app.use(bodyParser.json());

    app.get('/blocks', function(req, res){
        res.send(JSON.stringify(blockchain));
    });
    app.post('/mineBlock', function(req, res){
        var newBlock = generateNextBlock(req.body.data);
        addBlock(newBlock);
        broadcast(responseLatestMsg());
        console.log('block added: ' + JSON.stringify(newBlock));
        res.send();
    });
    app.get('/peers', function(req, res){
        res.send(sockets.map(s => s._socket.remoteAddress + ':' + s._socket.remotePort));
    });
    app.post('/addPeer', function(req, res){
        connectToPeers([req.body.peer]);
        res.send();
    });
    app.post('/stop', function(req, res){
        res.send({'msg' : 'stopping server'});
        process.exit();
    });
    app.listen(http_port, function(){console.log('Listening http on port: ' + http_port)});
};

function initP2PServer(){
    var server = new WebSocket.Server({port: p2p_port});
    server.on('connection', function(ws){initConnection(ws)});
    console.log('listening websocket p2p port on: ' + p2p_port);

};

function initConnection(ws){
    sockets.push(ws);
    initMessageHandler(ws);
    initErrorHandler(ws);
    write(ws, queryChainLengthMsg());
};

function initMessageHandler(ws){
    ws.on('message', function (data){
        var message = JSON.parse(data);
        console.log('Received message' + JSON.stringify(message));
        switch (message.type) {
            case MessageType.QUERY_LATEST:
                write(ws, responseLatestMsg());
                break;
            case MessageType.QUERY_ALL:
                write(ws, responseChainMsg());
                break;
            case MessageType.RESPONSE_BLOCKCHAIN:
                handleBlockchainResponse(message);
                break;
        }
    });
};

function initErrorHandler(ws){
    var closeConnection = function(ws){
        console.log('connection failed to peer: ' + ws.url);
        sockets.splice(sockets.indexOf(ws), 1);
    };
    ws.on('close', function(){closeConnection(ws)});
    ws.on('error', function(){closeConnection(ws)});
};

//in seconds
var BLOCK_GENERATION_INTERVAL = 10;
//in blocks
var DIFFICULTY_ADJUSTMENT_INTERVAL = 10;

function getDifficulty(aBlockchain){
    const latestBlock = aBlockchain[blockchain.length-1];
    if(latestBlock.index % DIFFICULTY_ADJUSTMENT_INTERVAL === 0 && latestBlock.index !== 0){
        return getAdjustedDifficulty(latestBlock,aBlockchain);
    }
    else{
        return latestBlock.difficulty;
    }
}

function getAdjustedDifficulty(latestBlock,aBlockchain){
    const prevAdjustmentBlock = aBlockchain[blockchain.length - DIFFICULTY_ADJUSTMENT_INTERVAL];
    const timeExpected = BLOCK_GENERATION_INTERVAL * DIFFICULTY_INTERVAL;
    const timeTaken = latestBlock.timestamp - prevAdjustmentBlock.timestamp;
    if(timeTaken<timeExpected/2){
        return prevAdjustmentBlock.difficulty - 1;
    }
    else{
        return prevAdjustmentBlock.difficulty;
    }
}
// get new block
// blockData can be anything; transactions, strings, values, etc.
function generateNextBlock(blockData){
    var previousBlock = getLatestBlock();
    var difficulty = getDifficulty(getBlockchain());
    var nextIndex = previousBlock.index + 1;
    var nextTimestamp = new Date().getTime() / 1000;
    var newBlock = findBlock(nextIndex, previousBlock.hash, nextTimestamp, blockData,difficulty);
    
    return newBlock;
};

function findBlock(nextIndex, previoushash, nextTimestamp, blockData,difficulty){
    let nonce =0;
    while(true){
        var hash = calculateHash(nextIndex, previoushash, nextTimestamp, blockData, difficulty, nonce);
        if(hashMatchesDifficulty(hash,difficulty)){
            return new Block(nextIndex, previoushash, nextTimestamp, blockData, hash, difficulty, nonce); 
        }
        nonce++;
    }
}
// get hash
function calculateHashForBlock(block){
    return calculateHash(block.index, block.previousHash, block.timestamp, block.data, block.difficulty, block.nonce);
};

function calculateHash(index, previousHash, timestamp, data, difficulty, nonce){
    return CryptoJS.SHA256(index + previousHash + timestamp + data + difficulty + nonce).toString();
};

// add new block
// need validation test
function addBlock(newBlock){
    if (isValidNewBlock(newBlock, getLatestBlock())) {
        blockchain.push(newBlock);
    }
};

// validation test of new block
function isValidNewBlock(newBlock, previousBlock){
    if (previousBlock.index + 1 !== newBlock.index) {
        console.log('invalid index');
        return false;
    } else if (previousBlock.hash !== newBlock.previousHash) {
        console.log('invalid previoushash');
        return false;
    } else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
        console.log(typeof (newBlock.hash) + ' ' + typeof calculateHashForBlock(newBlock));
        console.log('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' + newBlock.hash);
        return false;
    }
    return true;
};

function getAccumulatedDifficulty(aBlockchain){
    return aBlockchain
    .map((block)=>block.difficulty)
    .map((difficulty)=> Math.pow(2,difficulty))
    .reduce((a,b)=>a+b);
};

function hashMatchesDifficulty(hash,difficulty){
    var hashBinary = hexToBinary(hash);
    var requiredPrefix = '0'.repeat(difficulty);
    return hashBinary.startsWith(requiredPrefix);

};

function hexToBinary(s){
    let ret = '';
    const lookupTable = {
        '0': '0000', '1': '0001', '2': '0010', '3': '0011', '4': '0100',
        '5': '0101', '6': '0110', '7': '0111', '8': '1000', '9': '1001',
        'a': '1010', 'b': '1011', 'c': '1100', 'd': '1101',
        'e': '1110', 'f': '1111'
    };
    for (let i = 0; i < s.length; i = i + 1) {
        if (lookupTable[s[i]]) {
            ret += lookupTable[s[i]];
        }
        else {
            return null;
        }
    }
    return ret;

}

function connectToPeers(newPeers){
    newPeers.forEach(function(peer){
        var ws = new WebSocket(peer);
        ws.on('open', function(){initConnection(ws)});
        ws.on('error', function(){
            console.log('connection failed')
        });
    });
};

function handleBlockchainResponse(message){
    var receivedBlocks = JSON.parse(message.data).sort(function(b1, b2){(b1.index - b2.index)});
    var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
    var latestBlockHeld = getLatestBlock();
    if (latestBlockReceived.index > latestBlockHeld.index) {
        console.log('blockchain possibly behind. We got: ' + latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
        if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
            console.log("We can append the received block to our chain");
            blockchain.push(latestBlockReceived);
            broadcast(responseLatestMsg());
        } else if (receivedBlocks.length === 1) {
            console.log("We have to query the chain from our peer");
            broadcast(queryAllMsg());
        } else {
            console.log("Received blockchain is longer than current blockchain");
            replaceChain(receivedBlocks);
        }
    } else {
        console.log('received blockchain is not longer than current blockchain. Do nothing');
    }
};

// WARNING!! you can modify the following implementaion according to your own consensus design.
// current consensus: the longest chain rule.

// longest -> heaviest
function replaceChain(newBlocks){
    if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
        console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
        blockchain = newBlocks;
        broadcast(responseLatestMsg());
    } else {
        console.log('Received blockchain invalid');
    }
};

// validation test of blockchain
function isValidChain(blockchainToValidate){
    if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(getGenesisBlock())) {
        return false;
    }
    var tempBlocks = [blockchainToValidate[0]];
    for (var i = 1; i < blockchainToValidate.length; i++) {
        if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i]);
        } else {
            return false;
        }
    }
    return true;
};

// get latest block
function getLatestBlock(){return blockchain[blockchain.length - 1]};

function queryChainLengthMsg(){return ({'type': MessageType.QUERY_LATEST})};
function queryAllMsg(){return ({'type': MessageType.QUERY_ALL})};
function responseChainMsg(){return ({
    'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
})};
function responseLatestMsg(){return ({
    'type': MessageType.RESPONSE_BLOCKCHAIN,
    'data': JSON.stringify([getLatestBlock()])
})};

function write(ws, message){ws.send(JSON.stringify(message))};
function broadcast(message){sockets.forEach(socket => write(socket, message))};


var COINBASE_AMOUNT = 50;
class UnspentTxOut{
    construcotr(txOutId, txOutIndex, address, amount){
        this.txOutId = txOutId;
        this.txOutIndex = txOutIndex;
        this.address = address;
        this.amount = amount;
        
    }
}
class TxIn{
}
class TxOut{
    constructor(address, amount){
        this.address = address;
        this.amount =amount;
    }
}
class Transaction{ 
}

function getTransactionId(transaction){
    var txInContent = transaction.txIns
    .map((txIn)=>txIn.txOutId + txIn.txOutIndex)
    .reduce((a,b)=> a  + b,'');
    var txOutContent = transaction.txOuts
    .map((txOut)=>txOut.address + txOut.amount)
    .reduce((a,b)=> a + b, '');
    return Crypto.SHA256(txInContent + txOutContent).toString();
}
function validateTransaction(transaction, aUnspentTxOuts){
    if(getTransactionId(transaction) !== transaction.id){
        return false;
    }
    var hasValidTxIns = transaction.txIns
    .map((txIn) => validateTxIn(txIn, transaction, aUnspentTxOuts))
    .reduce((a,b)=> a && b, true);
    if(!hasValidTxIns){
        return false;
    }
    var totalTxInValues = transaction. txIns
    .map((txIn) => getTxInAmount(txIn, aUnspentTxOuts))
    .reduce((a,b)=> (a + b), 0);
    var totalTxOutValues = transaction. txOuts
    .map((txOut )=> txOut, amount)
    .reduce((a,b)=> (a + b), 0);
    if(totalTxOutValues !== totalTxInValues){
        return false;
    }
    return true;
}
function validateBlockTransactions(aTransactions, aUnspentTxOuts, blockIndex){
    var coinbaseTx = aTransactions[0];
    if(!validateCoinbaseTx(coinbaseTx,blockIndex)){
        return false;
    }
    var txIns = _(aTransaction)
    .map((tx)=> tx.txIns)
    .flatten()
    .value();
    if(hasDuplicates(txIns)){
        return false;
    }
    var normalTransactions = aTransactions.slice(1);
    return normalTransactions.map((tx)=>validateTransaction(tx,aUnspentTxOuts))
    .reduce((a,b)=>(a && b),true);
}
function hasDuplicates(txIns){
    var groups=_.countBy(txIns, (txIn) => txIn.txOutId + txIn.txOutIndex);
    return _(groups)
    .map((value, key) => {
        if(value > 1){
            return true;
        }
        else{
            return false;
        }
    })
    .includes(true);
}
function validateCoinbaseTx(transaction, blockIndex){
    if(transaction == null){
        return false;
    }
    if(getTransactionId(transaction) !== transaction.id){
        return false;
    }
    if(transaction.txIns.length !== 1){
        return;
    }
    if(transaction.txIns[0].txOutIndex !== blockIndex){
        return false;
    }
    if(transaction.txOuts.length !== 1){
        return false;
    }
    if(transaction.txOuts[0].amount !== COINBASE_AMOUNT){
        return false;
    }
    return true;
}

function validateTxIn(txIn, transaction, aUnspentTxOuts){
    var referencedUTxOut = aUnspentTxOuts.find((uTxO) => uTxO.txOutId === txIn.txOutId && uTxO.txOutIndex === txIn.txOutIndex);
    if(referencedUTxOut == null){
        return false;
    }
    var address = referencedUTxOut.address;
    var key = ec.keyFromPublic(address, 'hex');
    var validSignature = key.verify(transaction.id, txIn.signature);
    if(!validSignature){
        return false;
    }
    return true;
}

function getTxInAmount(txIn, aUnspentTxOuts){
    return findUnspentTxOut(txIn.txOutId, txIn.txOutIndex, aUnspentTxOuts).amount;
}
function findUnspentTxOut(transactionId, index, aUnspentTxOuts){
    return aUnspentTxOuts.find((uTxO)=>uTxO.txOutId === transactionId && uTxO.txOutIndex === index);
}
function getCoinbaseTransaction(address, blockIndex){
    var t = new Transaction();
    var txIn = new TxIn();
    txIn.signature = '';
    txIn.txOutId = '';
    txIn.txOutIndex = blockIndex;
    t.txIns = [txIn];
    t.txOuts = [new TxOut(address, COINBASE_AMOUNT)];
    t.id = getTransactionId(t);
    return t;
}

function signTxIn(transaction, txInIndex, privateKey, aUnspentTxOuts){
    var txIn = transaction.txIns[txInIndex];
    var dataToSign = transaction.id;
    var referencedUnspentTxOut = findUnspentTxOut(txIn.txOutId, txIn.txOutIndex, aUnspentTxOuts);
    if(referencedUnspentTxOut == null){
        throw Error();
    }
    var referencedAddress = referencedUnspentTxOut.address;
    if(getPublicKey(privateKey) !== referencedAddress){
        throw Error();
    }
    var key = ec.keyFromPrivate(privateKey, 'hex');
    var signature = toHexString(key.sign(dataToSign).toDER());
    return signature;
}

function updateUnspentTxOuts(aTransactions, aUnspentTxOuts){
    var newUnspentTxOuts = aTransactions
    .map((t)=>{
        return t.txOuts.map((txOut,index) => new UnspentTxOut(t.id, index, txOut.address, txOut.amount));
    })
    .reduce((a,b)=>a.concat(b),[]);
    var consumedTxOuts = aTransactions
    .map((t) => t.txIns)
    .reduce((a,b) => a.concat(b), [])
    .map((txIn) => new UnspentTxOut(txIn.txOutId, txIn.txOutIndex, '', 0));
    var resultingUnspentTxOuts = aUnspentTxOuts
    .filter(((uTxO) => !findUnspentTxOut(uTxO.txOutId, uTxO.txoutIndex, consumedTxOuts)))
    .concat(newUnspentTxOuts);
    return resultingUnspent;
}
function processTransactions(aTransactions, aUnspentTxOuts, blockIndex){
    if(!isValidTransactionsStructure(aTransactions)){
        return null;
    }if(!validateBlockTransactions(aTransactions, aUnspentTxOuts, blockIndex)){
        return null;
    }
    return updateUnspentTxOuts(aTRansactions, aUnspentTxOuts);
}

function toHexString(byteArray){
    return Array.from(byteArray, (byte) => {
        return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('');
}

function getPublicKey(aPrivateKey){
    return ec.keyFromPrivate(aPrivateKey,'hex').getPublic().encode('hex');
}
function isValidTxInStructure(txIn){
    if(txIn == null){
        return flase;
    }
    else if(typeof txIn.signature !== 'string'){
        return false;
    }
    else if(typeof txIn.txOutId !== 'string'){
        return false;
    }
    else if(typeof txIn.txOutIndex !== 'number'){
        return false;
    }
    else{
        return true;
    }
}

function isValidTxOutStructure(txOut){
    if(txOut == null){
        return false;
    }
    else if(typeof txOut.address !== 'string'){
        return false;
    }
    else if(!isValidAddress(txOut.address)){
        return false;
    }
    else if(typeof txOut.amount !== 'number'){
        return false;
    }
    else{
        return true;
    }
}

function isValidTransactionStruture(transactions){
    return transactions
    .map(isValidTransactionStructure)
    .reduce((a, b)=>(a && b), true);
}
function isValidTransactionStructure(transaction){
    if(typeof transaction.id !== 'string'){
        return false;
    }
    if(!(transaction.txIns instanceof Array)){
        return false;
    }
    if(!transaction.txIns
        .map(isValidTxInstructure)
        .reduce((a, b)=>(a && b), true)){
            return false;
    }
    if(!(transaction.txOuts instanceof Array)){
        return false;
    }
    if(!transaction.txOuts
        .map(isValidTxOutstructure)
        .reduce((a, b)=>(a && b), true)){
            return false;
    }
    return true;

}

function isVlalidAddress(address){
    if(address.length !== 130){
        return false;
    }
    else if(address.match('^[a-fA-F0-9]+$') ===null){
        return false;
    }
    else if (!address.startsWith('04')) {
        return false;
    }
    return true;
}


// main
connectToPeers(initialPeers);
initHttpServer();
initP2PServer();
