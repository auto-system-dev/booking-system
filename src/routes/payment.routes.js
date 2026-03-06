const express = require('express');

function createPaymentRoutes(deps) {
    const {
        controller,
        paymentLimiter
    } = deps;

    const router = express.Router();

    router.post('/create', paymentLimiter, controller.createPayment);
    router.post('/return', paymentLimiter, controller.paymentReturn);
    router.get('/result', paymentLimiter, controller.paymentResult);
    router.post('/result', paymentLimiter, controller.paymentResult);

    return router;
}

module.exports = {
    createPaymentRoutes
};
