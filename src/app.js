const express = require('express');

function createApp() {
    return express();
}

module.exports = {
    createApp
};
