// src/api/controllers/billing.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const usageService = require('../../services/usage');
const { supabase } = require('../../services/supabase/client');

const billingController = {
  /**
   * Get current usage and billing info
   */
  async getBillingInfo(req, res, next) {
    try {
      const orgId = req.organization.id;
      
      const [ usage ] = await Promise.all([
        usageService.getUsageStats(orgId),
        // usageService.checkUpgradeNeeded(orgId)
      ]);
      
      const { data: org } = await supabase
        .from('organizations')
        .select('subscription_tier, subscription_status, stripe_customer_id')
        .eq('id', orgId)
        .single();
      
      res.json({
        usage,
        subscription: {
          tier: org.subscription_tier,
          status: org.subscription_status
        },
        // upgradeRecommendations: upgradeCheck.recommendations,
        // needsUpgrade: upgradeCheck.needsUpgrade
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Create Stripe checkout session for upgrade
   */
  async createCheckoutSession(req, res, next) {
    try {
      const orgId = req.organization.id;
      const { tier = 'PROFESSIONAL' } = req.body;
      
      // const userCount = await usageService.getUserCount(orgId);
      
      // Create or get Stripe customer
      let customerId = req.organization.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: req.user.email,
          metadata: {
            org_id: orgId,
            org_name: req.organization.name
          }
        });
        customerId = customer.id;
        
        // Update organization with customer ID
        await supabase
          .from('organizations')
          .update({ stripe_customer_id: customerId })
          .eq('id', orgId);
      }
      
      // Create checkout session
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'PingaPR Professional',
              description: 'Unlimited PRs and advanced features'
            },
            unit_amount: 500, // $5.00 per user
            recurring: {
              interval: 'month'
            }
          },
          quantity: 3, //fetch user count dunamically
        }],
        mode: 'subscription',
        success_url: `${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/billing/cancel`,
        metadata: {
          org_id: orgId,
          tier: tier
        }
      });
      
      res.json({ url: session.url });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Handle Stripe webhooks
   */
  async handleWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionCanceled(event.data.object);
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  },

  async handleCheckoutCompleted(session) {
    const orgId = session.metadata.org_id;
    const tier = session.metadata.tier;
    
    await supabase
      .from('organizations')
      .update({
        subscription_tier: tier,
        subscription_status: 'active',
        stripe_subscription_id: session.subscription
      })
      .eq('id', orgId);
  },

  async handleSubscriptionUpdated(subscription) {
    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .eq('stripe_subscription_id', subscription.id)
      .single();
    
    if (org) {
      await supabase
        .from('organizations')
        .update({
          subscription_status: subscription.status
        })
        .eq('id', org.id);
    }
  },

  async handleSubscriptionCanceled(subscription) {
    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .eq('stripe_subscription_id', subscription.id)
      .single();
    
    if (org) {
      await supabase
        .from('organizations')
        .update({
          subscription_tier: 'FREE',
          subscription_status: 'canceled',
          stripe_subscription_id: null
        })
        .eq('id', org.id);
    }
  }
};

module.exports = billingController;