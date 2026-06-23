-- CreateTable
CREATE TABLE "model_price" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputPer1M" DOUBLE PRECISION NOT NULL,
    "outputPer1M" DOUBLE PRECISION NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_price_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "model_price_model_key" ON "model_price"("model");
