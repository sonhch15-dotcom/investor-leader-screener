package com.sweethome.investor;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;

final class DonutChartView extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF oval = new RectF();
    private double[] values = new double[0];
    private int[] colors = new int[0];
    private boolean compact;

    DonutChartView(Context context) {
        super(context);
        setMinimumHeight(Ui.dp(context, 150));
    }

    void setSegments(double[] values, int[] colors) {
        this.values = values == null ? new double[0] : values;
        this.colors = colors == null ? new int[0] : colors;
        invalidate();
    }

    void setCompact(boolean compact) {
        this.compact = compact;
        requestLayout();
        invalidate();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int width = MeasureSpec.getSize(widthMeasureSpec);
        int desired = Ui.dp(getContext(), compact ? 126 : 178);
        setMeasuredDimension(width, resolveSize(desired, heightMeasureSpec));
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        double total = 0;
        for (double value : values) {
            if (value > 0) {
                total += value;
            }
        }

        int strokeSafePadding = compact ? Ui.dp(getContext(), 42) : Ui.dp(getContext(), 50);
        int size = Math.max(Ui.dp(getContext(), compact ? 72 : 110), Math.min(getWidth(), getHeight()) - strokeSafePadding);
        int left = (getWidth() - size) / 2;
        int top = (getHeight() - size) / 2;
        oval.set(left, top, left + size, top + size);

        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(size * (compact ? 0.18f : 0.22f));
        paint.setStrokeCap(Paint.Cap.BUTT);

        if (total <= 0) {
            paint.setColor(Ui.LINE);
            canvas.drawArc(oval, 0, 360, false, paint);
            return;
        }

        float start = -90f;
        for (int index = 0; index < values.length && index < colors.length; index++) {
            if (values[index] <= 0) {
                continue;
            }
            float sweep = (float) (values[index] / total * 360.0);
            paint.setColor(colors[index]);
            canvas.drawArc(oval, start, sweep, false, paint);
            start += sweep;
        }
    }
}
