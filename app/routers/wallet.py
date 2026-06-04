import random
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.wallet import WalletTransaction
from app.models.virtual_card import VirtualCard

router = APIRouter()


class TopupRequest(BaseModel):
    amount: float


# ── Wallet balance + transactions ─────────────────────────────────────

@router.get("")
async def get_wallet(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.refresh(current_user)
    result = await db.execute(
        select(WalletTransaction)
        .where(WalletTransaction.user_id == current_user.id)
        .order_by(WalletTransaction.created_at.desc())
        .limit(50)
    )
    txns = result.scalars().all()
    balance = float(current_user.wallet_balance or 0)
    return {
        "balance": balance,
        "transactions": [
            {
                "id": t.id,
                "type": t.type,
                "amount": float(t.amount),
                "balance_after": float(t.balance_after),
                "trip_id": t.trip_id,
                "description": t.description,
                "created_at": t.created_at.isoformat(),
            }
            for t in txns
        ],
    }


# ── Top-up ────────────────────────────────────────────────────────────

@router.post("/topup")
async def topup_wallet(
    body: TopupRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.amount < 500:
        raise HTTPException(status_code=400, detail="Kiwango cha chini ni TSh 500")
    if body.amount > 500_000:
        raise HTTPException(status_code=400, detail="Kiwango cha juu ni TSh 500,000 kwa wakati mmoja")

    await db.refresh(current_user)
    old_bal = Decimal(str(current_user.wallet_balance or 0))
    new_bal = old_bal + Decimal(str(body.amount))

    await db.execute(
        update(User).where(User.id == current_user.id).values(wallet_balance=new_bal)
    )

    txn = WalletTransaction(
        user_id=current_user.id,
        type="CREDIT",
        amount=Decimal(str(body.amount)),
        balance_after=new_bal,
        description=f"Top-up ya mkoba — TSh {int(body.amount):,}",
    )
    db.add(txn)
    await db.commit()

    return {"balance": float(new_bal), "message": "Pesa zimeongezwa!"}


# ── Virtual Card ──────────────────────────────────────────────────────

def _generate_card_number() -> str:
    digits = [4] + [random.randint(0, 9) for _ in range(15)]
    return ' '.join(''.join(str(d) for d in digits[i:i+4]) for i in range(0, 16, 4))


@router.get("/card")
async def get_card(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(VirtualCard).where(VirtualCard.user_id == current_user.id)
    )
    card = result.scalar_one_or_none()
    if not card:
        return None
    return {
        "card_number": card.card_number,
        "expiry_month": card.expiry_month,
        "expiry_year": card.expiry_year,
        "cvv": card.cvv,
    }


@router.post("/card")
async def create_card(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(VirtualCard).where(VirtualCard.user_id == current_user.id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Tayari una kadi ya mkoba")

    now = datetime.now(timezone.utc)
    card = VirtualCard(
        user_id=current_user.id,
        card_number=_generate_card_number(),
        expiry_month=random.randint(1, 12),
        expiry_year=now.year + random.randint(3, 5),
        cvv=str(random.randint(100, 999)),
    )
    db.add(card)
    await db.commit()
    await db.refresh(card)

    return {
        "card_number": card.card_number,
        "expiry_month": card.expiry_month,
        "expiry_year": card.expiry_year,
        "cvv": card.cvv,
    }
