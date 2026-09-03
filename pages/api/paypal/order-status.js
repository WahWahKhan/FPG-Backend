// pages/api/paypal/order-status.js
// 🆕 NEW ENDPOINT: Check order processing status
// This enables frontend to poll for order completion

import fetch from 'node-fetch';
import * as quoteStore from '../../../lib/quote-store';

// Simple in-memory order status tracking
// 🔧 NOTE: In production, replace this with a database (MongoDB, PostgreSQL, etc.)
const orderStatuses = new Map();

// Helper to set order status
export function setOrderStatus(orderNumber, status, data = {}) {
    orderStatuses.set(orderNumber, {
        status, // 'pending' | 'processing' | 'completed' | 'failed'
        data,
        timestamp: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
    });
    console.log(`📊 Order ${orderNumber} status set to: ${status}`);
    // Write-through to Redis (fire-and-forget) so status survives serverless
    // instance boundaries for the frontend's timeout polling.
    if (quoteStore.isConfigured()) {
        quoteStore.setOrderStatus(orderNumber, status, { data }).catch((e) =>
            console.error('order-status: Redis write-through failed:', e.message)
        );
    }
}

// Helper to get order status
export function getOrderStatus(orderNumber) {
    return orderStatuses.get(orderNumber);
}

// Helper to update order status
export function updateOrderStatus(orderNumber, updates) {
    const existing = orderStatuses.get(orderNumber);
    if (existing) {
        orderStatuses.set(orderNumber, {
            ...existing,
            ...updates,
            lastUpdated: new Date().toISOString()
        });
    }
    if (quoteStore.isConfigured()) {
        quoteStore.updateOrderStatus(orderNumber, updates).catch((e) =>
            console.error('order-status: Redis update-through failed:', e.message)
        );
    }
}

// Cleanup old orders (older than 1 hour)
setInterval(() => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [orderNumber, data] of orderStatuses.entries()) {
        const orderTime = new Date(data.timestamp).getTime();
        if (orderTime < oneHourAgo) {
            console.log(`🗑️ Cleaning up old order status: ${orderNumber}`);
            orderStatuses.delete(orderNumber);
        }
    }
}, 5 * 60 * 1000); // Run every 5 minutes

// ========================================
// MAIN API HANDLER
// ========================================
export default async function handler(req, res) {
    // CORS headers
    const origin = req.headers.origin;
    const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://fluidpowergroup.com.au',
        'https://www.fluidpowergroup.com.au',
    ];

    if (origin && origin.includes('.vercel.app')) {
        allowedOrigins.push(origin);
    }

    const isAllowed = allowedOrigins.includes(origin);

    if (isAllowed && origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (!origin) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            error: `Method ${req.method} not allowed` 
        });
    }

    try {
        const { orderNumber } = req.body;

        if (!orderNumber) {
            return res.status(400).json({ 
                success: false, 
                error: 'Order number is required' 
            });
        }

        console.log(`📊 Status check for order: ${orderNumber}`);

        // Prefer Redis (survives serverless instances), fall back to memory.
        let orderStatus = null;
        if (quoteStore.isConfigured()) {
            try {
                const redisStatus = await quoteStore.getOrderStatus(orderNumber);
                if (redisStatus) {
                    orderStatus = {
                        status: redisStatus.status,
                        data: redisStatus.data || {},
                        timestamp: redisStatus.updatedAt,
                        lastUpdated: redisStatus.updatedAt,
                    };
                }
            } catch (e) {
                console.error('order-status: Redis read failed, using memory:', e.message);
            }
        }
        if (!orderStatus) {
            orderStatus = getOrderStatus(orderNumber);
        }

        if (!orderStatus) {
            console.log(`❓ Order ${orderNumber} not found in status tracking`);
            return res.status(404).json({
                success: false,
                error: 'Order not found',
                status: 'unknown'
            });
        }

        console.log(`📊 Order ${orderNumber} current status: ${orderStatus.status}`);

        return res.status(200).json({
            success: true,
            orderNumber,
            status: orderStatus.status,
            timestamp: orderStatus.timestamp,
            lastUpdated: orderStatus.lastUpdated,
            data: orderStatus.data
        });

    } catch (error) {
        console.error('❌ Error in order-status endpoint:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
}