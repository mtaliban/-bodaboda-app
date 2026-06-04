from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.wallet import WalletTransaction

router = APIRouter()


class TopupRequest(BaseModel):
    amount: float


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
    balance = float(getattr(current_user, 'wallet_balance', 0) or 0)
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
    old_bal = Decimal(str(getattr(current_user, 'wallet_balance', 0) or 0))
    new_bal = old_bal + Decimal(str(body.amount))

    from sqlalchemy import update
    from app.models.user import User as UserModel
    await db.execute(
        update(UserModel).where(UserModel.id == current_user.id).values(wallet_balance=new_bal)
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
