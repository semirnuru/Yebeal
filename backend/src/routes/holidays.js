
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { parseAndValidateFloat } from '../utils/validation.js';

const router = Router();


router.get('/', async (req, res, next) => {
  try {
    const { activeOnly = 'true' } = req.query;

    const where = {};
    if (activeOnly === 'true') where.isActive = true;

    const holidays = await req.prisma.holiday.findMany({
      where,
      orderBy: { deadline: 'asc' },
    });

    res.json(holidays);
  } catch (err) {
    next(err);
  }
});


router.get('/goals', authenticate, async (req, res, next) => {
  try {
    const goals = await req.prisma.customerHoliday.findMany({
      where: { userId: req.user.id },
      include: { holiday: true },
      orderBy: { holiday: { deadline: 'asc' } },
    });

    res.json(goals);
  } catch (err) {
    next(err);
  }
});


router.post('/goals', authenticate, async (req, res, next) => {
  try {
    const { holidayId, targetAmount, animalPreference } = req.body;

    if (!holidayId || targetAmount === undefined || targetAmount === null) {
      return res.status(400).json({ error: 'Holiday ID and target amount are required.' });
    }

    const validatedTargetAmount = parseAndValidateFloat(targetAmount, 'targetAmount', true, 1);

    
    const holiday = await req.prisma.holiday.findUnique({ where: { id: holidayId } });
    if (!holiday) {
      return res.status(404).json({ error: 'Holiday not found.' });
    }

    
    if (validatedTargetAmount < holiday.minimumDeposit) {
      return res.status(400).json({ error: `Target amount must be at least ${holiday.minimumDeposit} ETB.` });
    }

    
    const existing = await req.prisma.customerHoliday.findFirst({
      where: { userId: req.user.id, holidayId },
    });
    
    let goal;
    if (existing) {
      if (existing.status === 'active') {
        return res.status(409).json({ error: 'You already have an active goal for this holiday.' });
      }
      
      goal = await req.prisma.customerHoliday.update({
        where: { id: existing.id },
        data: {
          targetAmount: validatedTargetAmount,
          currentAmount: 0, 
          animalPreference: animalPreference || null,
          status: 'active',
        },
        include: { holiday: true },
      });
    } else {
      goal = await req.prisma.customerHoliday.create({
        data: {
          userId: req.user.id,
          holidayId,
          targetAmount: validatedTargetAmount,
          currentAmount: 0,
          animalPreference: animalPreference || null,
          status: 'active',
        },
        include: { holiday: true },
      });
    }

    res.status(201).json(goal);
  } catch (err) {
    next(err);
  }
});


router.post('/goals/:id/deposit', authenticate, async (req, res, next) => {
  try {
    const { amount, method } = req.body;
    const goalId = req.params.id;

    if (amount === undefined || amount === null) {
      return res.status(400).json({ error: 'Amount is required.' });
    }

    const validatedAmount = parseAndValidateFloat(amount, 'amount', true, 0.01);

    const goal = await req.prisma.customerHoliday.findFirst({
      where: { id: goalId, userId: req.user.id, status: { in: ['active', 'completed'] } },
      include: { holiday: true },
    });

    if (!goal) {
      return res.status(404).json({ error: 'Active or completed goal not found.' });
    }

    
    const primaryWallet = await req.prisma.wallet.findFirst({
      where: { userId: req.user.id, isFamily: false },
    });

    if (!primaryWallet) {
      return res.status(400).json({ error: 'No primary wallet found.' });
    }

    
    const result = await req.prisma.$transaction(async (tx) => {
      const now = new Date();
      const lockUntilDate = goal.holiday.deadline;

      let amountToLock = validatedAmount;
      let amountToAvailable = 0;

      if (goal.status === 'completed') {
        amountToLock = 0;
        amountToAvailable = validatedAmount;
      } else {
        const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
        amountToLock = Math.min(validatedAmount, remaining);
        amountToAvailable = validatedAmount - amountToLock;
      }

      
      const daysDiff = Math.ceil((lockUntilDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      let bonusPercent = 0;
      if (daysDiff >= 180) bonusPercent = 0.05;
      else if (daysDiff >= 90) bonusPercent = 0.03;
      else if (daysDiff >= 30) bonusPercent = 0.02;

      const bonusAmount = Math.round(amountToLock * bonusPercent);

      
      const walletDataUpdate = {};
      if (amountToLock > 0) {
        walletDataUpdate.lockedBalance = { increment: amountToLock };
        walletDataUpdate.platformCredits = { increment: bonusAmount };
        walletDataUpdate.holidayId = goal.holidayId;

        if (!primaryWallet.lockedUntil || lockUntilDate > primaryWallet.lockedUntil) {
          walletDataUpdate.lockedUntil = lockUntilDate;
        }
      }
      if (amountToAvailable > 0) {
        walletDataUpdate.balance = { increment: amountToAvailable };
      }
      if (amountToLock === 0 && amountToAvailable === 0) {
        walletDataUpdate.balance = { increment: validatedAmount };
      }

      const updatedWallet = await tx.wallet.update({
        where: { id: primaryWallet.id },
        data: walletDataUpdate,
      });

      
      let updatedGoal = goal;
      if (goal.status !== 'completed') {
        const newAmount = goal.currentAmount + amountToLock;
        const status = newAmount >= goal.targetAmount ? 'completed' : 'active';
        updatedGoal = await tx.customerHoliday.update({
          where: { id: goalId },
          data: {
            currentAmount: newAmount,
            status,
          },
          include: { holiday: true },
        });
      }

      
      await tx.transaction.create({
        data: {
          walletId: primaryWallet.id,
          amount: validatedAmount,
          type: 'DEPOSIT',
          description: amountToLock > 0 ? `Holiday Savings Locked Deposit for ${goal.holiday.name}` : `Deposit for ${goal.holiday.name}`,
          method: method || 'Telebirr',
          holidayId: goal.holidayId,
          bonusAmount,
          lockedUntil: amountToLock > 0 ? lockUntilDate : null,
          balanceType: amountToLock > 0 ? 'LOCKED' : 'AVAILABLE',
        },
      });

      
      await tx.user.update({
        where: { id: req.user.id },
        data: { totalDeposits: { increment: validatedAmount } },
      });

      
      let notifMessage;
      if (amountToAvailable > 0 && amountToLock > 0) {
        notifMessage = `${amountToLock.toLocaleString()} ETB locked for your ${goal.holiday.name} goal (Bonus: ${bonusAmount.toLocaleString()} Credits). ${amountToAvailable.toLocaleString()} ETB added to available balance.`;
      } else if (amountToLock === 0) {
        notifMessage = `Goal already completed. ${validatedAmount.toLocaleString()} ETB added to your available balance.`;
      } else {
        notifMessage = `Your locked deposit of ${validatedAmount.toLocaleString()} ETB (Bonus: ${bonusAmount.toLocaleString()} Credits) has been locked towards ${goal.holiday.name} until ${lockUntilDate.toLocaleDateString()}.`;
      }

      await tx.notification.create({
        data: {
          userId: req.user.id,
          title: 'Holiday Deposit ✓',
          message: notifMessage,
          type: 'DEPOSIT',
        },
      });

      return { wallet: updatedWallet, goal: updatedGoal };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});


router.delete('/goals/:id', authenticate, async (req, res, next) => {
  try {
    const goal = await req.prisma.customerHoliday.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found.' });
    }

    await req.prisma.customerHoliday.update({
      where: { id: req.params.id },
      data: { status: 'cancelled' },
    });

    res.json({ message: 'Goal cancelled. Deposited money remains in your wallet.' });
  } catch (err) {
    next(err);
  }
});

export default router;
